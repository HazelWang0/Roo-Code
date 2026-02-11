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
 * 飞书通知配置接口
 */
export interface LarkNotificationConfig {
	/** 是否启用飞书通知 */
	enabled: boolean
	/** 飞书 Webhook URL（直接调用时使用） */
	webhookUrl?: string
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
