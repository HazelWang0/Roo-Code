/**
 * 任务事件监听器
 * 提供统一的事件监听和分发机制
 *
 * 设计说明：
 * - 单例模式，全局管理所有任务的事件监听
 * - 支持多任务并发监听
 * - 提供事件过滤和聚合功能
 * - 集成配置管理器，自动响应配置变化
 */

import { TaskNotificationAdapter } from "./TaskNotificationAdapter"
import { LarkNotificationService } from "./LarkNotificationService"
import { LarkConfigManager } from "./LarkConfigManager"
import type { Task } from "../../core/task/Task"
import {
	TaskNotificationEventType,
	type AnyTaskEventData,
	type TaskEventListener as TaskEventListenerCallback,
	type TaskEventFilterConfig,
	type TaskNotificationAdapterConfig,
} from "./types"

/**
 * 任务适配器信息
 */
interface TaskAdapterInfo {
	taskId: string
	adapter: TaskNotificationAdapter
	createdAt: number
}

/**
 * 全局事件监听器回调
 */
type GlobalEventCallback = (taskId: string, eventData: AnyTaskEventData) => void | Promise<void>

/**
 * 任务事件监听器类
 * 管理所有任务的通知适配器
 */
export class TaskEventListener {
	private static instance: TaskEventListener | null = null

	private adapters: Map<string, TaskAdapterInfo> = new Map()
	private globalListeners: Map<string, GlobalEventCallback[]> = new Map()
	private defaultConfig: Partial<TaskNotificationAdapterConfig>
	private notificationService: LarkNotificationService
	private configManager: LarkConfigManager
	private configSubscription?: { dispose: () => void }
	private isEnabled: boolean = true
	private enabledEvents: TaskNotificationEventType[] = []

	private constructor(config?: Partial<TaskNotificationAdapterConfig>) {
		this.defaultConfig = config || {}
		this.notificationService = LarkNotificationService.getInstance()
		this.configManager = LarkConfigManager.getInstance()
		this.syncFromConfigManager()
		this.subscribeToConfigChanges()
	}

	/**
	 * 从配置管理器同步配置
	 */
	private syncFromConfigManager(): void {
		try {
			this.isEnabled = this.configManager.isEnabled()
			this.enabledEvents = this.configManager.getEnabledEvents()
		} catch (error) {
			console.error("Failed to sync from config manager:", error)
		}
	}

	/**
	 * 订阅配置变化
	 */
	private subscribeToConfigChanges(): void {
		try {
			this.configSubscription = this.configManager.onConfigChange((config) => {
				this.isEnabled = config.enabled
				this.enabledEvents = this.configManager.getEnabledEvents()

				// 更新所有适配器的配置
				this.adapters.forEach((info) => {
					info.adapter.updateConfig({ enabled: this.isEnabled })
				})
			})
		} catch (error) {
			console.error("Failed to subscribe to config changes:", error)
		}
	}

	/**
	 * 检查特定事件类型是否启用
	 */
	public isEventTypeEnabled(eventType: TaskNotificationEventType): boolean {
		if (!this.isEnabled) {
			return false
		}
		return this.enabledEvents.includes(eventType)
	}

	/**
	 * 获取单例实例
	 */
	public static getInstance(config?: Partial<TaskNotificationAdapterConfig>): TaskEventListener {
		if (!TaskEventListener.instance) {
			TaskEventListener.instance = new TaskEventListener(config)
		}
		return TaskEventListener.instance
	}

	/**
	 * 重置单例（主要用于测试）
	 */
	public static resetInstance(): void {
		if (TaskEventListener.instance) {
			TaskEventListener.instance.configSubscription?.dispose()
			TaskEventListener.instance.detachAll()
			TaskEventListener.instance = null
		}
	}

	/**
	 * 启用/禁用监听器
	 */
	public setEnabled(enabled: boolean): void {
		this.isEnabled = enabled

		// 更新所有适配器的配置
		this.adapters.forEach((info) => {
			info.adapter.updateConfig({ enabled })
		})
	}

	/**
	 * 检查是否启用
	 */
	public getEnabled(): boolean {
		return this.isEnabled
	}

	/**
	 * 注册任务
	 * 为任务创建通知适配器并开始监听事件
	 */
	public registerTask(task: Task, config?: Partial<TaskNotificationAdapterConfig>): TaskNotificationAdapter {
		const taskId = task.taskId

		// 如果已存在，先解除注册
		if (this.adapters.has(taskId)) {
			this.unregisterTask(taskId)
		}

		// 创建适配器
		const adapterConfig: Partial<TaskNotificationAdapterConfig> = {
			...this.defaultConfig,
			...config,
			enabled: this.isEnabled && config?.enabled !== false,
		}

		const adapter = new TaskNotificationAdapter(adapterConfig)

		// 设置全局事件转发
		adapter.on("*", (eventData) => {
			this.forwardToGlobalListeners(taskId, eventData)
		})

		// 附加到任务
		adapter.attach(task)

		// 保存适配器信息
		this.adapters.set(taskId, {
			taskId,
			adapter,
			createdAt: Date.now(),
		})

		return adapter
	}

	/**
	 * 解除任务注册
	 */
	public unregisterTask(taskId: string): void {
		const info = this.adapters.get(taskId)
		if (info) {
			info.adapter.detach()
			info.adapter.removeAllListeners()
			this.adapters.delete(taskId)
		}
	}

	/**
	 * 获取任务的适配器
	 */
	public getAdapter(taskId: string): TaskNotificationAdapter | undefined {
		return this.adapters.get(taskId)?.adapter
	}

	/**
	 * 检查任务是否已注册
	 */
	public isTaskRegistered(taskId: string): boolean {
		return this.adapters.has(taskId)
	}

	/**
	 * 获取所有已注册的任务 ID
	 */
	public getRegisteredTaskIds(): string[] {
		return Array.from(this.adapters.keys())
	}

	/**
	 * 获取已注册任务数量
	 */
	public getRegisteredTaskCount(): number {
		return this.adapters.size
	}

	/**
	 * 解除所有任务注册
	 */
	public detachAll(): void {
		this.adapters.forEach((info) => {
			info.adapter.detach()
			info.adapter.removeAllListeners()
		})
		this.adapters.clear()
	}

	/**
	 * 添加全局事件监听器
	 * 监听所有任务的指定事件类型
	 */
	public onGlobal(eventType: TaskNotificationEventType | "*", callback: GlobalEventCallback): void {
		const key = eventType === "*" ? "all" : eventType
		const listeners = this.globalListeners.get(key) || []
		listeners.push(callback)
		this.globalListeners.set(key, listeners)
	}

	/**
	 * 移除全局事件监听器
	 */
	public offGlobal(eventType: TaskNotificationEventType | "*", callback: GlobalEventCallback): void {
		const key = eventType === "*" ? "all" : eventType
		const listeners = this.globalListeners.get(key) || []
		const index = listeners.indexOf(callback)
		if (index !== -1) {
			listeners.splice(index, 1)
			this.globalListeners.set(key, listeners)
		}
	}

	/**
	 * 移除所有全局监听器
	 */
	public removeAllGlobalListeners(): void {
		this.globalListeners.clear()
	}

	/**
	 * 手动触发任务事件
	 */
	public async emitTaskEvent(taskId: string, eventData: AnyTaskEventData): Promise<void> {
		const adapter = this.getAdapter(taskId)
		if (adapter) {
			await adapter.notify(eventData)
		}
	}

	/**
	 * 更新默认配置
	 */
	public updateDefaultConfig(config: Partial<TaskNotificationAdapterConfig>): void {
		this.defaultConfig = { ...this.defaultConfig, ...config }
	}

	/**
	 * 获取任务统计信息
	 */
	public getStats(): {
		totalTasks: number
		activeTasks: number
		oldestTaskAge: number | null
	} {
		const now = Date.now()
		let oldestAge: number | null = null

		this.adapters.forEach((info) => {
			const age = now - info.createdAt
			if (oldestAge === null || age > oldestAge) {
				oldestAge = age
			}
		})

		return {
			totalTasks: this.adapters.size,
			activeTasks: Array.from(this.adapters.values()).filter((info) => info.adapter.isTaskAttached()).length,
			oldestTaskAge: oldestAge,
		}
	}

	/**
	 * 清理过期的任务适配器
	 * @param maxAgeMs 最大存活时间（毫秒）
	 */
	public cleanupStaleAdapters(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
		const now = Date.now()
		let cleanedCount = 0

		this.adapters.forEach((info, taskId) => {
			// 如果适配器已经不再附加到任务，且超过最大存活时间
			if (!info.adapter.isTaskAttached() && now - info.createdAt > maxAgeMs) {
				this.unregisterTask(taskId)
				cleanedCount++
			}
		})

		return cleanedCount
	}

	// ============================================
	// 私有方法
	// ============================================

	/**
	 * 转发事件到全局监听器
	 */
	private async forwardToGlobalListeners(taskId: string, eventData: AnyTaskEventData): Promise<void> {
		// 触发特定事件类型的监听器
		const specificListeners = this.globalListeners.get(eventData.event) || []
		for (const listener of specificListeners) {
			try {
				await listener(taskId, eventData)
			} catch (error) {
				console.error(`[TaskEventListener] Global listener error for ${eventData.event}:`, error)
			}
		}

		// 触发通配符监听器
		const allListeners = this.globalListeners.get("all") || []
		for (const listener of allListeners) {
			try {
				await listener(taskId, eventData)
			} catch (error) {
				console.error(`[TaskEventListener] Global wildcard listener error:`, error)
			}
		}
	}
}

/**
 * 便捷函数：获取 TaskEventListener 实例
 */
export function getTaskEventListener(): TaskEventListener {
	return TaskEventListener.getInstance()
}

/**
 * 便捷函数：注册任务到事件监听器
 */
export function registerTaskForNotification(
	task: Task,
	config?: Partial<TaskNotificationAdapterConfig>,
): TaskNotificationAdapter {
	return TaskEventListener.getInstance().registerTask(task, config)
}

/**
 * 便捷函数：解除任务注册
 */
export function unregisterTaskFromNotification(taskId: string): void {
	TaskEventListener.getInstance().unregisterTask(taskId)
}
