/**
 * 飞书通知服务
 * 负责将 Roo Code 任务状态推送到飞书
 */

import type {
	LarkNotificationConfig,
	TaskNotificationData,
	EnhancedTaskNotificationData,
	NotificationResult,
	NotificationEvent,
	NotificationEventType,
	TaskNotificationStatus,
	LogLevel,
	TaskLog,
	LarkCardAction,
} from "./types"

// 默认配置
const DEFAULT_CONFIG: LarkNotificationConfig = {
	enabled: false,
	useMcp: true,
	mcpServerName: "task-manager",
	retryCount: 3,
	retryDelay: 1000,
}

// 事件监听器类型
type EventListener = (event: NotificationEvent) => void

/**
 * 飞书通知服务类
 * 支持通过 MCP 或直接 Webhook 发送通知
 */
export class LarkNotificationService {
	private static instance: LarkNotificationService | null = null
	private config: LarkNotificationConfig
	private isInitialized: boolean = false
	private taskLogs: Map<string, TaskLog[]> = new Map()
	private eventListeners: Map<string, Set<EventListener>> = new Map()

	// MCP 工具调用函数（由外部注入）
	private mcpToolCaller?: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>

	private constructor(config?: Partial<LarkNotificationConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * 获取单例实例
	 */
	public static getInstance(config?: Partial<LarkNotificationConfig>): LarkNotificationService {
		if (!LarkNotificationService.instance) {
			LarkNotificationService.instance = new LarkNotificationService(config)
		}
		return LarkNotificationService.instance
	}

	/**
	 * 重置单例（主要用于测试）
	 */
	public static resetInstance(): void {
		if (LarkNotificationService.instance) {
			LarkNotificationService.instance.removeAllListeners()
			LarkNotificationService.instance = null
		}
	}

	/**
	 * 初始化服务
	 */
	public async initialize(config?: Partial<LarkNotificationConfig>): Promise<void> {
		if (config) {
			this.config = { ...this.config, ...config }
		}
		this.isInitialized = true
		this.log("info", "LarkNotificationService initialized", { config: this.config })
	}

	/**
	 * 设置 MCP 工具调用函数
	 */
	public setMcpToolCaller(
		caller: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>,
	): void {
		this.mcpToolCaller = caller
		this.log("info", "MCP tool caller set")
	}

	/**
	 * 更新配置
	 */
	public updateConfig(config: Partial<LarkNotificationConfig>): void {
		this.config = { ...this.config, ...config }
		this.log("info", "Configuration updated", { config: this.config })
	}

	/**
	 * 获取当前配置
	 */
	public getConfig(): LarkNotificationConfig {
		return { ...this.config }
	}

	/**
	 * 检查服务是否启用
	 */
	public isEnabled(): boolean {
		return this.config.enabled
	}

	/**
	 * 发送任务创建通知
	 */
	public async notifyTaskCreated(data: TaskNotificationData): Promise<NotificationResult> {
		return this.sendNotification({
			...data,
			status: "created" as TaskNotificationStatus,
			timestamp: data.timestamp || Date.now(),
		})
	}

	/**
	 * 发送任务进度更新通知
	 */
	public async notifyTaskProgress(data: TaskNotificationData): Promise<NotificationResult> {
		return this.sendNotification({
			...data,
			status: "in_progress" as TaskNotificationStatus,
			timestamp: data.timestamp || Date.now(),
		})
	}

	/**
	 * 发送任务完成通知
	 */
	public async notifyTaskCompleted(data: TaskNotificationData): Promise<NotificationResult> {
		return this.sendNotification({
			...data,
			status: "completed" as TaskNotificationStatus,
			timestamp: data.timestamp || Date.now(),
		})
	}

	/**
	 * 发送任务失败通知
	 */
	public async notifyTaskFailed(data: TaskNotificationData): Promise<NotificationResult> {
		return this.sendNotification({
			...data,
			status: "failed" as TaskNotificationStatus,
			timestamp: data.timestamp || Date.now(),
		})
	}

	/**
	 * 发送增强的任务通知（包含详细信息）
	 */
	public async notifyTaskEnhanced(data: EnhancedTaskNotificationData): Promise<NotificationResult> {
		return this.sendNotification(data)
	}

	/**
	 * 添加任务日志
	 */
	public addTaskLog(taskId: string, level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
		const logs = this.taskLogs.get(taskId) || []
		const log: TaskLog = {
			time: new Date().toISOString(),
			level,
			message,
			metadata,
		}
		logs.push(log)
		this.taskLogs.set(taskId, logs)
	}

	/**
	 * 获取任务日志
	 */
	public getTaskLogs(taskId: string): TaskLog[] {
		return this.taskLogs.get(taskId) || []
	}

	/**
	 * 清除任务日志
	 */
	public clearTaskLogs(taskId: string): void {
		this.taskLogs.delete(taskId)
	}

	/**
	 * 核心通知发送方法
	 */
	private async sendNotification(
		data: TaskNotificationData | EnhancedTaskNotificationData,
	): Promise<NotificationResult> {
		if (!this.config.enabled) {
			this.log("debug", "Notification skipped - service disabled", { taskId: data.taskId })
			return { success: true, messageId: undefined }
		}

		const retryCount = this.config.retryCount || 3
		const retryDelay = this.config.retryDelay || 1000
		let lastError: string | undefined

		for (let attempt = 1; attempt <= retryCount; attempt++) {
			try {
				const result = await this.doSendNotification(data)

				this.emitEvent("notification:sent", data)
				this.log("info", `Notification sent successfully`, {
					taskId: data.taskId,
					status: data.status,
					attempt,
				})

				return result
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error)
				this.log("warn", `Notification attempt ${attempt} failed`, {
					taskId: data.taskId,
					error: lastError,
				})

				if (attempt < retryCount) {
					this.emitEvent("notification:retry", data)
					await this.delay(retryDelay * attempt)
				}
			}
		}

		this.emitEvent("notification:failed", data, lastError)
		this.log("error", "All notification attempts failed", {
			taskId: data.taskId,
			error: lastError,
		})

		return { success: false, error: lastError }
	}

	/**
	 * 实际发送通知的方法
	 */
	private async doSendNotification(
		data: TaskNotificationData | EnhancedTaskNotificationData,
	): Promise<NotificationResult> {
		if (this.config.useMcp) {
			return this.sendViaMcp(data)
		} else if (this.config.webhookUrl) {
			return this.sendViaWebhook(data)
		} else {
			throw new Error("No notification method configured: either enable MCP or provide webhookUrl")
		}
	}

	/**
	 * 通过 MCP 发送通知
	 */
	private async sendViaMcp(data: TaskNotificationData | EnhancedTaskNotificationData): Promise<NotificationResult> {
		if (!this.mcpToolCaller) {
			throw new Error("MCP tool caller not set. Call setMcpToolCaller() first.")
		}

		const serverName = this.config.mcpServerName || "task-manager"
		const toolName = this.getToolNameForStatus(data.status)
		const args = this.buildMcpArgs(data)

		try {
			const result = (await this.mcpToolCaller(serverName, toolName, args)) as { messageId?: string }
			return {
				success: true,
				messageId: result?.messageId,
			}
		} catch (error) {
			throw new Error(`MCP call failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * 通过 Webhook 发送通知
	 */
	private async sendViaWebhook(
		data: TaskNotificationData | EnhancedTaskNotificationData,
	): Promise<NotificationResult> {
		if (!this.config.webhookUrl) {
			throw new Error("Webhook URL not configured")
		}

		const payload = this.buildWebhookPayload(data)

		const response = await fetch(this.config.webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		})

		if (!response.ok) {
			throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`)
		}

		const result = (await response.json()) as { data?: { message_id?: string } }
		return {
			success: true,
			messageId: result?.data?.message_id,
		}
	}

	/**
	 * 根据状态获取 MCP 工具名称
	 */
	private getToolNameForStatus(status: TaskNotificationStatus): string {
		switch (status) {
			case "created":
				return "create_coding_task"
			case "in_progress":
				return "update_task_progress"
			case "completed":
			case "failed":
				return "update_task_progress"
			default:
				return "update_task_progress"
		}
	}

	/**
	 * 构建 MCP 调用参数
	 */
	private buildMcpArgs(data: TaskNotificationData | EnhancedTaskNotificationData): Record<string, unknown> {
		const status = data.status as string

		if (status === "created") {
			return {
				title: data.taskName,
				description: (data as EnhancedTaskNotificationData).description || data.message || "",
				userId: (data as EnhancedTaskNotificationData).userId,
			}
		}

		// 状态映射
		const statusMap: Record<string, string> = {
			created: "pending",
			in_progress: "running",
			completed: "completed",
			failed: "failed",
		}

		return {
			taskId: data.taskId,
			status: statusMap[status] || "running",
			progress: data.progress,
		}
	}

	/**
	 * 构建 Webhook 请求体
	 */
	private buildWebhookPayload(data: TaskNotificationData | EnhancedTaskNotificationData): Record<string, unknown> {
		const card = this.buildLarkCard(data)
		return {
			msg_type: "interactive",
			card,
		}
	}

	/**
	 * 构建飞书卡片消息
	 */
	private buildLarkCard(data: TaskNotificationData | EnhancedTaskNotificationData): Record<string, unknown> {
		const statusEmoji = this.getStatusEmoji(data.status)
		const statusText = this.getStatusText(data.status)
		const progressBar = this.buildProgressBar(data.progress || 0)

		const elements: Record<string, unknown>[] = []

		// 任务描述
		if (data.message || (data as EnhancedTaskNotificationData).description) {
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: (data as EnhancedTaskNotificationData).description || data.message || "",
				},
			})
			elements.push({ tag: "hr" })
		}

		// 状态和进度
		elements.push({
			tag: "div",
			fields: [
				{
					is_short: true,
					text: {
						tag: "lark_md",
						content: `**状态:** ${statusEmoji} ${statusText}`,
					},
				},
				{
					is_short: true,
					text: {
						tag: "lark_md",
						content: `**进度:** ${data.progress || 0}%`,
					},
				},
			],
		})

		// 进度条
		elements.push({
			tag: "div",
			text: {
				tag: "lark_md",
				content: progressBar,
			},
		})

		// 错误信息
		if (data.error) {
			elements.push({ tag: "hr" })
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: `⚠️ **错误:** ${data.error}`,
				},
			})
		}

		// 增强信息
		const enhancedData = data as EnhancedTaskNotificationData
		if (enhancedData.codeStats) {
			elements.push({ tag: "hr" })
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: this.buildCodeStatsText(enhancedData.codeStats),
				},
			})
		}

		return {
			config: {
				wide_screen_mode: true,
			},
			header: {
				title: {
					tag: "plain_text",
					content: `${statusEmoji} ${data.taskName}`,
				},
				template: this.getHeaderTemplate(data.status),
			},
			elements,
		}
	}

	/**
	 * 获取状态对应的 emoji
	 */
	private getStatusEmoji(status: TaskNotificationStatus): string {
		const emojiMap: Record<string, string> = {
			created: "🆕",
			in_progress: "⏳",
			completed: "✅",
			failed: "❌",
		}
		return emojiMap[status as string] || "📋"
	}

	/**
	 * 获取状态文本
	 */
	private getStatusText(status: TaskNotificationStatus): string {
		const textMap: Record<string, string> = {
			created: "已创建",
			in_progress: "进行中",
			completed: "已完成",
			failed: "失败",
		}
		return textMap[status as string] || "未知"
	}

	/**
	 * 获取卡片头部模板颜色
	 */
	private getHeaderTemplate(status: TaskNotificationStatus): string {
		const templateMap: Record<string, string> = {
			created: "blue",
			in_progress: "orange",
			completed: "green",
			failed: "red",
		}
		return templateMap[status as string] || "blue"
	}

	/**
	 * 构建进度条
	 */
	private buildProgressBar(progress: number): string {
		const filled = Math.floor(progress / 5)
		const empty = 20 - filled
		return `\`[${"█".repeat(filled)}${"░".repeat(empty)}]\``
	}

	/**
	 * 构建代码统计文本
	 */
	private buildCodeStatsText(stats: EnhancedTaskNotificationData["codeStats"]): string {
		if (!stats) return ""
		return [
			"**📊 代码统计:**",
			`• 创建文件: ${stats.filesCreated}`,
			`• 修改文件: ${stats.filesModified}`,
			`• 删除文件: ${stats.filesDeleted}`,
			`• 新增行数: +${stats.linesAdded}`,
			`• 删除行数: -${stats.linesRemoved}`,
		].join("\n")
	}

	/**
	 * 添加事件监听器
	 */
	public on(event: NotificationEventType | "notification", listener: EventListener): this {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, new Set())
		}
		this.eventListeners.get(event)!.add(listener)
		return this
	}

	/**
	 * 移除事件监听器
	 */
	public off(event: NotificationEventType | "notification", listener: EventListener): this {
		const listeners = this.eventListeners.get(event)
		if (listeners) {
			listeners.delete(listener)
		}
		return this
	}

	/**
	 * 移除所有事件监听器
	 */
	public removeAllListeners(): this {
		this.eventListeners.clear()
		return this
	}

	/**
	 * 发出事件
	 */
	private emitEvent(type: NotificationEventType, data: TaskNotificationData | LarkCardAction, error?: string): void {
		const event: NotificationEvent = {
			type,
			data,
			timestamp: new Date(),
			error,
		}

		// 触发特定事件监听器
		const listeners = this.eventListeners.get(type)
		if (listeners) {
			listeners.forEach((listener) => listener(event))
		}

		// 触发通用事件监听器
		const allListeners = this.eventListeners.get("notification")
		if (allListeners) {
			allListeners.forEach((listener) => listener(event))
		}
	}

	/**
	 * 延迟函数
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * 内部日志方法
	 */
	private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
		const prefix = "[LarkNotificationService]"
		const fullMessage = `${prefix} ${message}`

		switch (level) {
			case "error":
				console.error(fullMessage, metadata || "")
				break
			case "warn":
				console.warn(fullMessage, metadata || "")
				break
			case "info":
				console.log(fullMessage, metadata || "")
				break
			case "debug":
				// 只在调试模式下输出
				break
		}
	}

	/**
	 * 销毁服务
	 */
	public dispose(): void {
		this.removeAllListeners()
		this.taskLogs.clear()
		this.isInitialized = false
		this.log("info", "LarkNotificationService disposed")
	}
}
