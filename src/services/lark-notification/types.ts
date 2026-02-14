/**
 * 飞书通知服务类型定义
 * 用于 Roo Code 任务状态推送到飞书
 */

/**
 * 任务通知状态枚举
 */
export enum TaskNotificationStatus {
	CREATED = "created",
	IN_PROGRESS = "in_progress",
	COMPLETED = "completed",
	FAILED = "failed",
}

/**
 * 飞书机器人类型枚举
 */
export enum LarkBotType {
	/** Webhook 机器人 - 简单，只需 URL */
	WEBHOOK = "webhook",
	/** 应用机器人 - 功能强大，需要 App ID/Secret/Chat ID */
	APP = "app",
}

/**
 * 飞书应用机器人配置
 */
export interface LarkAppBotConfig {
	/** 应用 ID */
	appId: string
	/** 应用密钥 */
	appSecret: string
	/** 群聊 ID */
	chatId: string
}

/**
 * 飞书通知配置接口
 */
export interface LarkNotificationConfig {
	/** 是否启用飞书通知 */
	enabled: boolean
	/** 机器人类型 */
	botType?: LarkBotType
	/** 飞书 Webhook URL（Webhook 机器人使用） */
	webhookUrl?: string
	/** 应用机器人配置 */
	appBot?: LarkAppBotConfig
	/** 是否通过 MCP 调用飞书服务 */
	useMcp: boolean
	/** MCP 服务器名称 */
	mcpServerName?: string
	/** 重试次数 */
	retryCount?: number
	/** 重试延迟（毫秒） */
	retryDelay?: number
}

/**
 * 飞书应用机器人 Token 响应
 */
export interface LarkTenantAccessTokenResponse {
	code: number
	msg: string
	tenant_access_token?: string
	expire?: number
}

/**
 * 飞书发送消息响应
 */
export interface LarkSendMessageResponse {
	code: number
	msg: string
	data?: {
		message_id?: string
	}
}

/**
 * 任务通知数据
 */
export interface TaskNotificationData {
	/** 任务 ID */
	taskId: string
	/** 任务名称 */
	taskName: string
	/** 任务状态 */
	status: TaskNotificationStatus
	/** 进度百分比 (0-100) */
	progress?: number
	/** 消息内容 */
	message?: string
	/** 错误信息 */
	error?: string
	/** 时间戳 */
	timestamp: number
}

/**
 * 代码统计信息
 */
export interface CodeStats {
	filesCreated: number
	filesModified: number
	filesDeleted: number
	linesAdded: number
	linesRemoved: number
	tokensUsed: number
	tokensTotal: number
}

/**
 * 任务步骤
 */
export interface TaskStep {
	id: string
	name: string
	status: "pending" | "running" | "completed" | "failed" | "skipped"
	startTime?: string
	endTime?: string
	duration?: number
	output?: string
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
	id: string
	name: string
	status: "pending" | "running" | "completed" | "failed"
	startTime: string
	endTime?: string
	input?: Record<string, unknown>
	output?: string
	error?: string
}

/**
 * 费用信息
 */
export interface CostInfo {
	inputTokens: number
	outputTokens: number
	totalTokens: number
	estimatedCost: number
	currency: string
}

/**
 * 增强的任务通知数据（包含详细信息）
 */
export interface EnhancedTaskNotificationData extends TaskNotificationData {
	/** 任务描述 */
	description?: string
	/** 代码统计 */
	codeStats?: CodeStats
	/** 当前步骤 */
	currentStep?: TaskStep
	/** 所有步骤 */
	steps?: TaskStep[]
	/** 工具调用记录 */
	toolCalls?: ToolCallRecord[]
	/** 费用信息 */
	cost?: CostInfo
	/** 飞书消息 ID（用于更新卡片） */
	messageId?: string
	/** 用户 ID */
	userId?: string
}

/**
 * 通知发送结果
 */
export interface NotificationResult {
	success: boolean
	messageId?: string
	error?: string
}

/**
 * MCP 工具调用参数
 */
export interface McpToolCallParams {
	serverName: string
	toolName: string
	arguments: Record<string, unknown>
}

/**
 * 飞书卡片操作
 */
export interface LarkCardAction {
	action: "pause" | "resume" | "modify" | "logs" | "cancel" | "detail" | "retry"
	taskId: string
	userId?: string
	openId?: string
	messageId?: string
}

/**
 * 通知服务事件类型
 */
export type NotificationEventType = "notification:sent" | "notification:failed" | "notification:retry" | "card:action"

/**
 * 通知服务事件
 */
export interface NotificationEvent {
	type: NotificationEventType
	data: TaskNotificationData | LarkCardAction
	timestamp: Date
	error?: string
}

/**
 * 日志级别
 */
export type LogLevel = "info" | "warn" | "error" | "debug"

/**
 * 任务日志
 */
export interface TaskLog {
	time: string
	level: LogLevel
	message: string
	metadata?: Record<string, unknown>
}

// ============================================
// 阶段二：事件系统集成类型定义
// ============================================

/**
 * 任务通知事件类型枚举
 * 用于标识不同的任务生命周期事件
 */
export enum TaskNotificationEventType {
	/** 任务开始 */
	TASK_STARTED = "task_started",
	/** 任务进度更新 */
	TASK_PROGRESS = "task_progress",
	/** 工具调用 */
	TASK_TOOL_USE = "task_tool_use",
	/** 任务完成 */
	TASK_COMPLETED = "task_completed",
	/** 任务失败 */
	TASK_FAILED = "task_failed",
	/** 任务取消 */
	TASK_CANCELLED = "task_cancelled",
	/** 任务暂停 */
	TASK_PAUSED = "task_paused",
	/** 任务恢复 */
	TASK_RESUMED = "task_resumed",
	/** Token 使用更新 */
	TASK_TOKEN_UPDATED = "task_token_updated",
}

/**
 * 任务事件数据接口
 * 包含事件的基本信息
 */
export interface TaskEventData {
	/** 事件类型 */
	event: TaskNotificationEventType
	/** 任务 ID */
	taskId: string
	/** 事件时间戳 */
	timestamp: number
	/** 附加数据 */
	data?: Record<string, unknown>
}

/**
 * 任务开始事件数据
 */
export interface TaskStartedEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_STARTED
	data: {
		/** 任务名称/描述 */
		taskName: string
		/** 任务模式 */
		mode?: string
		/** 父任务 ID（如果是子任务） */
		parentTaskId?: string
	}
}

/**
 * 任务进度事件数据
 */
export interface TaskProgressEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_PROGRESS
	data: {
		/** 进度百分比 (0-100) */
		progress?: number
		/** 当前步骤描述 */
		currentStep?: string
		/** 消息内容 */
		message?: string
	}
}

/**
 * 工具调用事件数据
 */
export interface TaskToolUseEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_TOOL_USE
	data: {
		/** 工具名称 */
		toolName: string
		/** 工具状态 */
		status: "started" | "completed" | "failed"
		/** 工具输入参数 */
		input?: Record<string, unknown>
		/** 工具输出 */
		output?: string
		/** 错误信息 */
		error?: string
	}
}

/**
 * 任务完成事件数据
 */
export interface TaskCompletedEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_COMPLETED
	data: {
		/** 完成结果摘要 */
		result?: string
		/** Token 使用统计 */
		tokenUsage?: {
			inputTokens: number
			outputTokens: number
			totalTokens: number
		}
		/** 工具使用统计 */
		toolUsage?: Record<string, number>
		/** 总耗时（毫秒） */
		duration?: number
	}
}

/**
 * 任务失败事件数据
 */
export interface TaskFailedEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_FAILED
	data: {
		/** 错误信息 */
		error: string
		/** 错误类型 */
		errorType?: string
		/** 失败时的步骤 */
		failedStep?: string
	}
}

/**
 * 任务取消事件数据
 */
export interface TaskCancelledEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_CANCELLED
	data: {
		/** 取消原因 */
		reason?: string
		/** 取消时的进度 */
		progress?: number
	}
}

/**
 * Token 使用更新事件数据
 */
export interface TaskTokenUpdatedEventData extends TaskEventData {
	event: TaskNotificationEventType.TASK_TOKEN_UPDATED
	data: {
		/** 输入 Token 数 */
		inputTokens: number
		/** 输出 Token 数 */
		outputTokens: number
		/** 总 Token 数 */
		totalTokens: number
		/** 缓存读取 Token 数 */
		cacheReadTokens?: number
		/** 缓存写入 Token 数 */
		cacheWriteTokens?: number
		/** 预估费用 */
		estimatedCost?: number
	}
}

/**
 * 所有任务事件数据的联合类型
 */
export type AnyTaskEventData =
	| TaskStartedEventData
	| TaskProgressEventData
	| TaskToolUseEventData
	| TaskCompletedEventData
	| TaskFailedEventData
	| TaskCancelledEventData
	| TaskTokenUpdatedEventData

/**
 * 事件监听器回调函数类型
 */
export type TaskEventListener = (eventData: AnyTaskEventData) => void | Promise<void>

/**
 * 事件过滤器配置
 */
export interface TaskEventFilterConfig {
	/** 要监听的事件类型列表，为空则监听所有 */
	eventTypes?: TaskNotificationEventType[]
	/** 要监听的任务 ID 列表，为空则监听所有 */
	taskIds?: string[]
	/** 是否包含子任务事件 */
	includeSubtasks?: boolean
}

/**
 * 节流配置
 */
export interface ThrottleConfig {
	/** 是否启用节流 */
	enabled: boolean
	/** 节流间隔（毫秒） */
	intervalMs: number
	/** 要节流的事件类型 */
	eventTypes?: TaskNotificationEventType[]
}

/**
 * 任务通知适配器配置
 */
export interface TaskNotificationAdapterConfig {
	/** 是否启用 */
	enabled: boolean
	/** 事件过滤器 */
	filter?: TaskEventFilterConfig
	/** 节流配置 */
	throttle?: ThrottleConfig
	/** 是否自动发送通知 */
	autoNotify?: boolean
}
