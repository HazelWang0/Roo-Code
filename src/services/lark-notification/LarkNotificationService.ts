/**
 * 飞书通知服务
 * 负责将 Roo Code 任务状态推送到飞书
 */

import * as vscode from "vscode"
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
	LarkTenantAccessTokenResponse,
	LarkSendMessageResponse,
} from "./types"
import { LarkBotType } from "./types"
import { LarkConfigManager } from "./LarkConfigManager"

// 飞书 API 端点
const LARK_API = {
	TENANT_ACCESS_TOKEN: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
	SEND_MESSAGE: "https://open.feishu.cn/open-apis/im/v1/messages",
}

// Token 缓存接口
interface TokenCache {
	token: string
	expireAt: number // Unix timestamp in milliseconds
}

// 默认配置
// 注意：useMcp 默认为 false，因为 mcpToolCaller 需要外部注入
// 如果用户配置了 appBot 凭据，将自动使用应用机器人发送通知
const DEFAULT_CONFIG: LarkNotificationConfig = {
	enabled: false,
	botType: LarkBotType.APP,
	useMcp: false,
	mcpServerName: "task-manager",
	retryCount: 3,
	retryDelay: 1000,
}

// 事件监听器类型
type EventListener = (event: NotificationEvent) => void

/**
 * 飞书通知服务类
 * 支持通过 MCP、Webhook 机器人或应用机器人发送通知
 */
export class LarkNotificationService {
	private static instance: LarkNotificationService | null = null
	private static outputChannel: vscode.OutputChannel | null = null
	private config: LarkNotificationConfig
	private isInitialized: boolean = false
	private taskLogs: Map<string, TaskLog[]> = new Map()
	private eventListeners: Map<string, Set<EventListener>> = new Map()
	private configManagerSubscription?: { dispose: () => void }

	// MCP 工具调用函数（由外部注入）
	private mcpToolCaller?: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>

	// 应用机器人 Token 缓存
	private tokenCache: TokenCache | null = null

	/**
	 * 获取调试输出通道
	 */
	private static getOutputChannel(): vscode.OutputChannel {
		if (!LarkNotificationService.outputChannel) {
			LarkNotificationService.outputChannel = vscode.window.createOutputChannel("Lark Notification Debug")
		}
		return LarkNotificationService.outputChannel
	}

	/**
	 * 输出调试日志到 VSCode 输出面板
	 */
	private debugLog(message: string, data?: unknown): void {
		const channel = LarkNotificationService.getOutputChannel()
		const timestamp = new Date().toISOString()
		const logMessage = data
			? `[${timestamp}] [LarkNotificationService] ${message}: ${JSON.stringify(data, null, 2)}`
			: `[${timestamp}] [LarkNotificationService] ${message}`
		channel.appendLine(logMessage)
		console.log(logMessage)
	}

	private constructor(config?: Partial<LarkNotificationConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.debugLog("Constructor called", { config: this.config })
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
			LarkNotificationService.instance.configManagerSubscription?.dispose()
			LarkNotificationService.instance = null
		}
	}

	/**
	 * 初始化服务
	 * @param config 可选的配置覆盖
	 * @param useConfigManager 是否使用配置管理器（默认 true）
	 */
	public async initialize(config?: Partial<LarkNotificationConfig>, useConfigManager: boolean = true): Promise<void> {
		this.debugLog("initialize() called", { useConfigManager, configOverride: config })

		if (useConfigManager) {
			// 从配置管理器获取配置
			this.debugLog("Syncing from ConfigManager")
			this.syncFromConfigManager()
			// 订阅配置变化
			this.subscribeToConfigChanges()
		}

		if (config) {
			this.config = { ...this.config, ...config }
		}
		this.isInitialized = true
		this.debugLog("initialize() completed", {
			enabled: this.config.enabled,
			botType: this.config.botType,
			useMcp: this.config.useMcp,
			mcpServerName: this.config.mcpServerName,
			hasMcpToolCaller: !!this.mcpToolCaller,
			hasAppBot: !!this.config.appBot,
			hasWebhookUrl: !!this.config.webhookUrl,
		})
		this.log("info", "LarkNotificationService initialized", { config: this.config })
	}

	/**
	 * 从配置管理器同步配置
	 */
	public syncFromConfigManager(): void {
		try {
			const configManager = LarkConfigManager.getInstance()
			const managerConfig = configManager.getConfig()
			this.config = { ...this.config, ...managerConfig }
			this.log("debug", "Config synced from ConfigManager", { config: this.config })
		} catch (error) {
			this.log("warn", "Failed to sync config from ConfigManager", { error })
		}
	}

	/**
	 * 订阅配置管理器的变化
	 */
	private subscribeToConfigChanges(): void {
		try {
			const configManager = LarkConfigManager.getInstance()
			this.configManagerSubscription = configManager.onConfigChange((newConfig) => {
				this.config = { ...this.config, ...newConfig }
				this.log("info", "Config updated from ConfigManager", { config: this.config })
			})
		} catch (error) {
			this.log("warn", "Failed to subscribe to config changes", { error })
		}
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
		this.debugLog("sendNotification() called", {
			taskId: data.taskId,
			status: data.status,
			enabled: this.config.enabled,
		})

		if (!this.config.enabled) {
			this.debugLog("sendNotification() skipped - service disabled")
			this.log("debug", "Notification skipped - service disabled", { taskId: data.taskId })
			return { success: true, messageId: undefined }
		}

		const retryCount = this.config.retryCount || 3
		const retryDelay = this.config.retryDelay || 1000
		let lastError: string | undefined

		for (let attempt = 1; attempt <= retryCount; attempt++) {
			try {
				this.debugLog(`Attempting to send notification (attempt ${attempt}/${retryCount})`)
				const result = await this.doSendNotification(data)

				this.emitEvent("notification:sent", data)
				this.debugLog("Notification sent successfully", { attempt, result })
				this.log("info", `Notification sent successfully`, {
					taskId: data.taskId,
					status: data.status,
					attempt,
				})

				return result
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error)
				this.debugLog(`Notification attempt ${attempt} failed`, { error: lastError })
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
		this.debugLog("All notification attempts failed", { error: lastError })
		this.log("error", "All notification attempts failed", {
			taskId: data.taskId,
			error: lastError,
		})

		return { success: false, error: lastError }
	}

	/**
	 * 实际发送通知的方法
	 * 优先级：MCP > App Bot > Webhook
	 * 如果 MCP 配置了但 mcpToolCaller 未设置，自动回退到其他方式
	 */
	private async doSendNotification(
		data: TaskNotificationData | EnhancedTaskNotificationData,
	): Promise<NotificationResult> {
		this.debugLog("doSendNotification() called", {
			useMcp: this.config.useMcp,
			botType: this.config.botType,
			hasAppBot: !!this.config.appBot,
			hasWebhookUrl: !!this.config.webhookUrl,
			hasMcpToolCaller: !!this.mcpToolCaller,
		})

		// 如果配置了 MCP 且 mcpToolCaller 已设置，使用 MCP
		if (this.config.useMcp && this.mcpToolCaller) {
			this.debugLog("Using MCP to send notification")
			return this.sendViaMcp(data)
		}

		// 如果配置了 MCP 但 mcpToolCaller 未设置，记录警告并尝试回退
		if (this.config.useMcp && !this.mcpToolCaller) {
			this.debugLog("MCP configured but mcpToolCaller not set, falling back to other methods")
			this.log("warn", "MCP configured but mcpToolCaller not set, attempting fallback", {
				taskId: data.taskId,
			})
		}

		// 回退到应用机器人
		if (this.config.botType === LarkBotType.APP && this.config.appBot) {
			this.debugLog("Using App Bot to send notification")
			return this.sendViaAppBot(data)
		}

		// 回退到 Webhook
		if (this.config.webhookUrl) {
			this.debugLog("Using Webhook to send notification")
			return this.sendViaWebhook(data)
		}

		// 没有可用的发送方式
		this.debugLog("No notification method available!")
		throw new Error(
			"No notification method available: MCP tool caller not set, and no app bot or webhook configured. " +
				"Please configure appId/appSecret/chatId for app bot, or provide webhookUrl.",
		)
	}

	/**
	 * 通过 MCP 发送通知
	 */
	private async sendViaMcp(data: TaskNotificationData | EnhancedTaskNotificationData): Promise<NotificationResult> {
		this.debugLog("sendViaMcp() called", { hasMcpToolCaller: !!this.mcpToolCaller })
		if (!this.mcpToolCaller) {
			this.debugLog("MCP tool caller not set!")
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
	 * 通过应用机器人发送通知
	 */
	private async sendViaAppBot(
		data: TaskNotificationData | EnhancedTaskNotificationData,
	): Promise<NotificationResult> {
		if (!this.config.appBot) {
			throw new Error("App bot configuration not set")
		}

		const { appId, appSecret, chatId } = this.config.appBot

		// 获取或刷新 token
		const token = await this.getTenantAccessToken(appId, appSecret)

		// 构建消息内容
		const messageContent = this.buildAppBotMessageContent(data)

		// 发送消息
		const response = await fetch(`${LARK_API.SEND_MESSAGE}?receive_id_type=chat_id`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				receive_id: chatId,
				msg_type: "interactive",
				content: JSON.stringify(messageContent),
			}),
		})

		if (!response.ok) {
			throw new Error(`App bot request failed: ${response.status} ${response.statusText}`)
		}

		const result = (await response.json()) as LarkSendMessageResponse
		if (result.code !== 0) {
			throw new Error(`Lark API error: ${result.code} - ${result.msg}`)
		}

		return {
			success: true,
			messageId: result.data?.message_id,
		}
	}

	/**
	 * 获取 tenant_access_token（带缓存）
	 */
	private async getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
		// 检查缓存是否有效（提前 5 分钟过期）
		const now = Date.now()
		if (this.tokenCache && this.tokenCache.expireAt > now + 5 * 60 * 1000) {
			return this.tokenCache.token
		}

		// 请求新 token
		const response = await fetch(LARK_API.TENANT_ACCESS_TOKEN, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				app_id: appId,
				app_secret: appSecret,
			}),
		})

		if (!response.ok) {
			throw new Error(`Failed to get tenant access token: ${response.status} ${response.statusText}`)
		}

		const result = (await response.json()) as LarkTenantAccessTokenResponse
		if (result.code !== 0 || !result.tenant_access_token) {
			throw new Error(`Lark auth error: ${result.code} - ${result.msg}`)
		}

		// 缓存 token
		this.tokenCache = {
			token: result.tenant_access_token,
			expireAt: now + (result.expire || 7200) * 1000,
		}

		this.log("info", "Tenant access token refreshed", {
			expireAt: new Date(this.tokenCache.expireAt).toISOString(),
		})

		return result.tenant_access_token
	}

	/**
	 * 构建应用机器人消息内容（交互式卡片格式）
	 * 注意：使用直接构建的卡片格式，不使用模板卡片
	 */
	private buildAppBotMessageContent(data: TaskNotificationData | EnhancedTaskNotificationData): object {
		const statusEmoji = this.getStatusEmoji(data.status)
		const statusText = this.getStatusText(data.status)
		const progressText = data.progress !== undefined ? `${data.progress}%` : "-"

		// 构建 elements 数组
		const elements: object[] = [
			{
				tag: "div",
				fields: [
					{
						is_short: true,
						text: {
							tag: "lark_md",
							content: `**状态:** ${statusText}`,
						},
					},
					{
						is_short: true,
						text: {
							tag: "lark_md",
							content: `**进度:** ${progressText}`,
						},
					},
				],
			},
			{
				tag: "div",
				text: {
					tag: "lark_md",
					content: `**任务 ID:** ${data.taskId}`,
				},
			},
		]

		// 添加消息（如果有）
		if (data.message) {
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: `**消息:** ${data.message}`,
				},
			})
		}

		// 添加错误信息（如果有）
		if (data.error) {
			elements.push({
				tag: "div",
				text: {
					tag: "lark_md",
					content: `**错误:** ${data.error}`,
				},
			})
		}

		// 添加分隔线和时间戳
		elements.push(
			{ tag: "hr" },
			{
				tag: "note",
				elements: [
					{
						tag: "plain_text",
						content: `更新时间: ${new Date(data.timestamp).toLocaleString("zh-CN")}`,
					},
				],
			},
		)

		// 返回正确的交互式卡片格式（不使用 type: "template"）
		return {
			config: {
				wide_screen_mode: true,
				enable_forward: true,
				update_multi: true,
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
		switch (status) {
			case "created":
				return "🆕"
			case "in_progress":
				return "🔄"
			case "completed":
				return "✅"
			case "failed":
				return "❌"
			default:
				return "📋"
		}
	}

	/**
	 * 获取状态文本
	 */
	private getStatusText(status: TaskNotificationStatus): string {
		switch (status) {
			case "created":
				return "已创建"
			case "in_progress":
				return "进行中"
			case "completed":
				return "已完成"
			case "failed":
				return "失败"
			default:
				return status
		}
	}

	/**
	 * 获取卡片头部模板颜色
	 */
	private getHeaderTemplate(status: TaskNotificationStatus): string {
		switch (status) {
			case "created":
				return "blue"
			case "in_progress":
				return "wathet"
			case "completed":
				return "green"
			case "failed":
				return "red"
			default:
				return "grey"
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
