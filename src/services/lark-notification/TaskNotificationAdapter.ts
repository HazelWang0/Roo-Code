/**
 * 任务通知适配器
 * 将 Task 的内部状态变化转换为通知事件
 *
 * 设计说明：
 * - 使用松耦合设计，通过 EventEmitter 接口与 Task 交互
 * - 支持事件过滤和节流，避免过多通知
 * - 自动将 Task 事件转换为飞书通知格式
 */

import type { Task } from "../../core/task/Task"
import { LarkNotificationService } from "./LarkNotificationService"
import {
	TaskNotificationEventType,
	TaskNotificationStatus,
	type AnyTaskEventData,
	type TaskEventListener,
	type TaskNotificationAdapterConfig,
	type TaskNotificationData,
	type TaskStartedEventData,
	type TaskProgressEventData,
	type TaskToolUseEventData,
	type TaskCompletedEventData,
	type TaskFailedEventData,
	type TaskCancelledEventData,
	type TaskTokenUpdatedEventData,
} from "./types"

// 默认配置
const DEFAULT_CONFIG: TaskNotificationAdapterConfig = {
	enabled: true,
	autoNotify: true,
	throttle: {
		enabled: true,
		intervalMs: 2000,
		eventTypes: [TaskNotificationEventType.TASK_PROGRESS, TaskNotificationEventType.TASK_TOKEN_UPDATED],
	},
}

// 简化的 Token 使用类型
interface SimpleTokenUsage {
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
}

// 简化的工具使用类型
interface SimpleToolUsage {
	[toolName: string]: number
}

// 简化的消息类型
interface SimpleMessage {
	type?: string
	say?: string
	ask?: string
	text?: string
	ts?: number
}

/**
 * 任务通知适配器类
 * 负责监听 Task 事件并转换为飞书通知
 */
export class TaskNotificationAdapter {
	private task: Task | null = null
	private config: TaskNotificationAdapterConfig
	private notificationService: LarkNotificationService
	private eventListeners: Map<string, TaskEventListener[]> = new Map()
	private lastEventTime: Map<TaskNotificationEventType, number> = new Map()
	private pendingEvents: Map<TaskNotificationEventType, AnyTaskEventData> = new Map()
	private throttleTimers: Map<TaskNotificationEventType, ReturnType<typeof setTimeout>> = new Map()
	private taskStartTime: number = 0
	private isAttached: boolean = false

	// 存储事件处理器引用，用于解绑 - 使用 any 类型避免复杂的类型推断
	private boundHandlers: Map<string, (...args: any[]) => void> = new Map()

	constructor(config?: Partial<TaskNotificationAdapterConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.notificationService = LarkNotificationService.getInstance()
	}

	/**
	 * 附加到 Task 实例
	 */
	public attach(task: Task): void {
		if (this.isAttached) {
			this.detach()
		}

		this.task = task
		this.taskStartTime = Date.now()
		this.isAttached = true

		// 绑定事件处理器
		this.bindTaskEvents()

		// 发送任务开始事件
		this.emitTaskStarted()
	}

	/**
	 * 从 Task 实例解除绑定
	 */
	public detach(): void {
		if (!this.isAttached || !this.task) {
			return
		}

		// 清理节流定时器
		this.throttleTimers.forEach((timer) => clearTimeout(timer))
		this.throttleTimers.clear()

		// 解绑事件处理器
		this.unbindTaskEvents()

		// 清理状态
		this.task = null
		this.isAttached = false
		this.lastEventTime.clear()
		this.pendingEvents.clear()
		this.taskStartTime = 0
	}

	/**
	 * 手动触发通知
	 */
	public async notify(eventData: AnyTaskEventData): Promise<void> {
		if (!this.config.enabled) {
			return
		}

		// 检查事件过滤
		if (!this.shouldProcessEvent(eventData)) {
			return
		}

		// 检查节流
		if (this.shouldThrottle(eventData.event)) {
			this.pendingEvents.set(eventData.event, eventData)
			this.scheduleThrottledEvent(eventData.event)
			return
		}

		// 更新最后事件时间
		this.lastEventTime.set(eventData.event, Date.now())

		// 触发本地监听器
		await this.emitToListeners(eventData)

		// 如果启用自动通知，发送到飞书
		if (this.config.autoNotify) {
			await this.sendNotification(eventData)
		}
	}

	/**
	 * 添加事件监听器
	 */
	public on(eventType: TaskNotificationEventType | "*", listener: TaskEventListener): void {
		const key = eventType === "*" ? "all" : eventType
		const listeners = this.eventListeners.get(key) || []
		listeners.push(listener)
		this.eventListeners.set(key, listeners)
	}

	/**
	 * 移除事件监听器
	 */
	public off(eventType: TaskNotificationEventType | "*", listener: TaskEventListener): void {
		const key = eventType === "*" ? "all" : eventType
		const listeners = this.eventListeners.get(key) || []
		const index = listeners.indexOf(listener)
		if (index !== -1) {
			listeners.splice(index, 1)
			this.eventListeners.set(key, listeners)
		}
	}

	/**
	 * 移除所有监听器
	 */
	public removeAllListeners(): void {
		this.eventListeners.clear()
	}

	/**
	 * 获取当前任务 ID
	 */
	public getTaskId(): string | undefined {
		return this.task?.taskId
	}

	/**
	 * 检查是否已附加
	 */
	public isTaskAttached(): boolean {
		return this.isAttached
	}

	/**
	 * 更新配置
	 */
	public updateConfig(config: Partial<TaskNotificationAdapterConfig>): void {
		this.config = { ...this.config, ...config }
	}

	// ============================================
	// 私有方法
	// ============================================

	/**
	 * 绑定 Task 事件
	 * Task 继承自 EventEmitter<TaskEvents>，使用标准的 on/off 方法
	 */
	private bindTaskEvents(): void {
		if (!this.task) return

		// 使用类型断言来访问 EventEmitter 方法
		const emitter = this.task as unknown as {
			on(event: string, listener: (...args: any[]) => void): void
			off(event: string, listener: (...args: any[]) => void): void
		}

		// 任务完成事件
		const taskCompletedHandler = (taskId: string, tokenUsage: SimpleTokenUsage, toolUsage: SimpleToolUsage) => {
			this.handleTaskCompleted(taskId, tokenUsage, toolUsage)
		}
		this.boundHandlers.set("taskCompleted", taskCompletedHandler)
		emitter.on("taskCompleted", taskCompletedHandler)

		// 任务中止事件
		const taskAbortedHandler = () => {
			this.handleTaskAborted()
		}
		this.boundHandlers.set("taskAborted", taskAbortedHandler)
		emitter.on("taskAborted", taskAbortedHandler)

		// Token 使用更新事件
		const tokenUpdatedHandler = (taskId: string, tokenUsage: SimpleTokenUsage, _toolUsage: SimpleToolUsage) => {
			this.handleTokenUpdated(taskId, tokenUsage)
		}
		this.boundHandlers.set("taskTokenUsageUpdated", tokenUpdatedHandler)
		emitter.on("taskTokenUsageUpdated", tokenUpdatedHandler)

		// 工具失败事件
		const toolFailedHandler = (taskId: string, tool: string, error: string) => {
			this.handleToolFailed(taskId, tool, error)
		}
		this.boundHandlers.set("taskToolFailed", toolFailedHandler)
		emitter.on("taskToolFailed", toolFailedHandler)

		// 消息事件（用于跟踪进度）
		const messageHandler = (data: { action: string; message: SimpleMessage }) => {
			this.handleMessage(data)
		}
		this.boundHandlers.set("message", messageHandler)
		emitter.on("message", messageHandler)
	}

	/**
	 * 解绑 Task 事件
	 */
	private unbindTaskEvents(): void {
		if (!this.task) return

		const emitter = this.task as unknown as {
			on(event: string, listener: (...args: any[]) => void): void
			off(event: string, listener: (...args: any[]) => void): void
		}

		this.boundHandlers.forEach((handler, eventName) => {
			emitter.off(eventName, handler)
		})
		this.boundHandlers.clear()
	}

	/**
	 * 发送任务开始事件
	 */
	private emitTaskStarted(): void {
		if (!this.task) return

		const eventData: TaskStartedEventData = {
			event: TaskNotificationEventType.TASK_STARTED,
			taskId: this.task.taskId,
			timestamp: Date.now(),
			data: {
				taskName: this.task.metadata?.task || "Unknown Task",
				mode: (this.task as any).taskMode,
				parentTaskId: this.task.parentTaskId,
			},
		}

		this.notify(eventData)
	}

	/**
	 * 处理任务完成事件
	 */
	private handleTaskCompleted(taskId: string, tokenUsage: SimpleTokenUsage, toolUsage: SimpleToolUsage): void {
		const eventData: TaskCompletedEventData = {
			event: TaskNotificationEventType.TASK_COMPLETED,
			taskId,
			timestamp: Date.now(),
			data: {
				tokenUsage: {
					inputTokens: tokenUsage?.inputTokens || 0,
					outputTokens: tokenUsage?.outputTokens || 0,
					totalTokens: tokenUsage?.totalTokens || 0,
				},
				toolUsage: toolUsage || {},
				duration: Date.now() - this.taskStartTime,
			},
		}

		this.notify(eventData)
	}

	/**
	 * 处理任务中止事件
	 */
	private handleTaskAborted(): void {
		if (!this.task) return

		// 检查是用户取消还是错误导致的中止
		const abortReason = (this.task as any).abortReason

		if (abortReason === "user_cancelled") {
			const eventData: TaskCancelledEventData = {
				event: TaskNotificationEventType.TASK_CANCELLED,
				taskId: this.task.taskId,
				timestamp: Date.now(),
				data: {
					reason: "User cancelled",
				},
			}
			this.notify(eventData)
		} else {
			const eventData: TaskFailedEventData = {
				event: TaskNotificationEventType.TASK_FAILED,
				taskId: this.task.taskId,
				timestamp: Date.now(),
				data: {
					error: abortReason || "Task aborted",
					errorType: "abort",
				},
			}
			this.notify(eventData)
		}
	}

	/**
	 * 处理 Token 使用更新事件
	 */
	private handleTokenUpdated(taskId: string, tokenUsage: SimpleTokenUsage): void {
		const eventData: TaskTokenUpdatedEventData = {
			event: TaskNotificationEventType.TASK_TOKEN_UPDATED,
			taskId,
			timestamp: Date.now(),
			data: {
				inputTokens: tokenUsage?.inputTokens || 0,
				outputTokens: tokenUsage?.outputTokens || 0,
				totalTokens: tokenUsage?.totalTokens || 0,
				cacheReadTokens: tokenUsage?.cacheReadTokens,
				cacheWriteTokens: tokenUsage?.cacheWriteTokens,
			},
		}

		this.notify(eventData)
	}

	/**
	 * 处理工具失败事件
	 */
	private handleToolFailed(taskId: string, tool: string, error: string): void {
		const eventData: TaskToolUseEventData = {
			event: TaskNotificationEventType.TASK_TOOL_USE,
			taskId,
			timestamp: Date.now(),
			data: {
				toolName: tool,
				status: "failed",
				error,
			},
		}

		this.notify(eventData)
	}

	/**
	 * 处理消息事件
	 */
	private handleMessage(data: { action: string; message: SimpleMessage }): void {
		if (!this.task) return

		const { action, message } = data

		// 只处理新创建的消息
		if (action !== "created") return

		// 根据消息类型生成进度事件
		if (message.say === "api_req_started") {
			const eventData: TaskProgressEventData = {
				event: TaskNotificationEventType.TASK_PROGRESS,
				taskId: this.task.taskId,
				timestamp: Date.now(),
				data: {
					currentStep: "Processing API request",
					message: "Sending request to AI model...",
				},
			}
			this.notify(eventData)
		} else if (message.say === "tool") {
			// 工具调用开始
			try {
				const toolInfo = message.text ? JSON.parse(message.text) : {}
				const eventData: TaskToolUseEventData = {
					event: TaskNotificationEventType.TASK_TOOL_USE,
					taskId: this.task.taskId,
					timestamp: Date.now(),
					data: {
						toolName: toolInfo.tool || "unknown",
						status: "started",
						input: toolInfo.params,
					},
				}
				this.notify(eventData)
			} catch {
				// 忽略解析错误
			}
		} else if (message.say === "completion_result") {
			// 任务完成结果
			const eventData: TaskProgressEventData = {
				event: TaskNotificationEventType.TASK_PROGRESS,
				taskId: this.task.taskId,
				timestamp: Date.now(),
				data: {
					progress: 100,
					currentStep: "Task completed",
					message: message.text?.substring(0, 200),
				},
			}
			this.notify(eventData)
		}
	}

	/**
	 * 检查是否应该处理事件
	 */
	private shouldProcessEvent(eventData: AnyTaskEventData): boolean {
		const filter = this.config.filter

		if (!filter) return true

		// 检查事件类型过滤
		if (filter.eventTypes && filter.eventTypes.length > 0) {
			if (!filter.eventTypes.includes(eventData.event)) {
				return false
			}
		}

		// 检查任务 ID 过滤
		if (filter.taskIds && filter.taskIds.length > 0) {
			if (!filter.taskIds.includes(eventData.taskId)) {
				return false
			}
		}

		// 检查子任务过滤
		if (filter.includeSubtasks === false && this.task?.parentTaskId) {
			return false
		}

		return true
	}

	/**
	 * 检查是否应该节流
	 */
	private shouldThrottle(eventType: TaskNotificationEventType): boolean {
		const throttle = this.config.throttle

		if (!throttle || !throttle.enabled) return false

		// 检查是否是需要节流的事件类型
		if (throttle.eventTypes && !throttle.eventTypes.includes(eventType)) {
			return false
		}

		// 检查时间间隔
		const lastTime = this.lastEventTime.get(eventType)
		if (!lastTime) return false

		return Date.now() - lastTime < throttle.intervalMs
	}

	/**
	 * 调度节流事件
	 */
	private scheduleThrottledEvent(eventType: TaskNotificationEventType): void {
		// 如果已有定时器，不重复创建
		if (this.throttleTimers.has(eventType)) return

		const throttle = this.config.throttle
		if (!throttle) return

		const timer = setTimeout(async () => {
			this.throttleTimers.delete(eventType)

			const pendingEvent = this.pendingEvents.get(eventType)
			if (pendingEvent) {
				this.pendingEvents.delete(eventType)
				this.lastEventTime.set(eventType, Date.now())
				await this.emitToListeners(pendingEvent)
				if (this.config.autoNotify) {
					await this.sendNotification(pendingEvent)
				}
			}
		}, throttle.intervalMs)

		this.throttleTimers.set(eventType, timer)
	}

	/**
	 * 触发本地监听器
	 */
	private async emitToListeners(eventData: AnyTaskEventData): Promise<void> {
		// 触发特定事件类型的监听器
		const specificListeners = this.eventListeners.get(eventData.event) || []
		for (const listener of specificListeners) {
			try {
				await listener(eventData)
			} catch (error) {
				console.error(`[TaskNotificationAdapter] Listener error:`, error)
			}
		}

		// 触发通配符监听器
		const allListeners = this.eventListeners.get("all") || []
		for (const listener of allListeners) {
			try {
				await listener(eventData)
			} catch (error) {
				console.error(`[TaskNotificationAdapter] Listener error:`, error)
			}
		}
	}

	/**
	 * 发送通知到飞书
	 */
	private async sendNotification(eventData: AnyTaskEventData): Promise<void> {
		if (!this.notificationService.isEnabled()) {
			return
		}

		try {
			const notificationData = this.convertToNotificationData(eventData)

			switch (eventData.event) {
				case TaskNotificationEventType.TASK_STARTED:
					await this.notificationService.notifyTaskCreated(notificationData)
					break
				case TaskNotificationEventType.TASK_PROGRESS:
				case TaskNotificationEventType.TASK_TOOL_USE:
				case TaskNotificationEventType.TASK_TOKEN_UPDATED:
					await this.notificationService.notifyTaskProgress(notificationData)
					break
				case TaskNotificationEventType.TASK_COMPLETED:
					await this.notificationService.notifyTaskCompleted(notificationData)
					break
				case TaskNotificationEventType.TASK_FAILED:
				case TaskNotificationEventType.TASK_CANCELLED:
					await this.notificationService.notifyTaskFailed(notificationData)
					break
				default:
					await this.notificationService.notifyTaskProgress(notificationData)
			}
		} catch (error) {
			console.error(`[TaskNotificationAdapter] Failed to send notification:`, error)
		}
	}

	/**
	 * 将事件数据转换为通知数据格式
	 */
	private convertToNotificationData(eventData: AnyTaskEventData): TaskNotificationData {
		const baseData: TaskNotificationData = {
			taskId: eventData.taskId,
			taskName: this.task?.metadata?.task || "Unknown Task",
			status: this.mapEventToStatus(eventData.event),
			timestamp: eventData.timestamp,
		}

		// 根据事件类型添加额外数据
		switch (eventData.event) {
			case TaskNotificationEventType.TASK_PROGRESS: {
				const progressData = eventData as TaskProgressEventData
				return {
					...baseData,
					progress: progressData.data?.progress,
					message: progressData.data?.message || progressData.data?.currentStep,
				}
			}
			case TaskNotificationEventType.TASK_COMPLETED: {
				const completedData = eventData as TaskCompletedEventData
				return {
					...baseData,
					message: completedData.data?.result,
				}
			}
			case TaskNotificationEventType.TASK_FAILED: {
				const failedData = eventData as TaskFailedEventData
				return {
					...baseData,
					error: failedData.data?.error,
					message: `Error: ${failedData.data?.error}`,
				}
			}
			case TaskNotificationEventType.TASK_CANCELLED: {
				const cancelledData = eventData as TaskCancelledEventData
				return {
					...baseData,
					message: `Cancelled: ${cancelledData.data?.reason || "User cancelled"}`,
				}
			}
			case TaskNotificationEventType.TASK_TOOL_USE: {
				const toolData = eventData as TaskToolUseEventData
				return {
					...baseData,
					message: `Tool: ${toolData.data?.toolName} (${toolData.data?.status})`,
				}
			}
			default:
				return baseData
		}
	}

	/**
	 * 将事件类型映射到通知状态
	 */
	private mapEventToStatus(eventType: TaskNotificationEventType): TaskNotificationStatus {
		switch (eventType) {
			case TaskNotificationEventType.TASK_STARTED:
				return TaskNotificationStatus.CREATED
			case TaskNotificationEventType.TASK_PROGRESS:
			case TaskNotificationEventType.TASK_TOOL_USE:
			case TaskNotificationEventType.TASK_TOKEN_UPDATED:
			case TaskNotificationEventType.TASK_PAUSED:
			case TaskNotificationEventType.TASK_RESUMED:
				return TaskNotificationStatus.IN_PROGRESS
			case TaskNotificationEventType.TASK_COMPLETED:
				return TaskNotificationStatus.COMPLETED
			case TaskNotificationEventType.TASK_FAILED:
			case TaskNotificationEventType.TASK_CANCELLED:
				return TaskNotificationStatus.FAILED
			default:
				return TaskNotificationStatus.IN_PROGRESS
		}
	}
}
