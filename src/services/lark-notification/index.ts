/**
 * 飞书通知服务模块
 * 导出所有公共 API
 */

// 导出服务类
export { LarkNotificationService } from "./LarkNotificationService"

// 导出配置管理器（阶段三）
export { LarkConfigManager, getLarkConfigManager, type ConfigChangeListener } from "./LarkConfigManager"

// 导出事件系统（阶段二）
export { TaskNotificationAdapter } from "./TaskNotificationAdapter"
export { TaskEventListener } from "./TaskEventListener"

// 导出类型定义
export {
	// 枚举
	TaskNotificationStatus,
	TaskNotificationEventType,
	// 配置接口
	type LarkNotificationConfig,
	type TaskNotificationAdapterConfig,
	type TaskEventFilterConfig,
	type ThrottleConfig,
	// 数据接口
	type TaskNotificationData,
	type EnhancedTaskNotificationData,
	type NotificationResult,
	// 统计和步骤
	type CodeStats,
	type TaskStep,
	type ToolCallRecord,
	type CostInfo,
	// 事件相关
	type NotificationEvent,
	type NotificationEventType,
	type LarkCardAction,
	// 任务事件数据类型（阶段二）
	type TaskEventData,
	type TaskStartedEventData,
	type TaskProgressEventData,
	type TaskToolUseEventData,
	type TaskCompletedEventData,
	type TaskFailedEventData,
	type TaskCancelledEventData,
	type TaskTokenUpdatedEventData,
	type AnyTaskEventData,
	type TaskEventListener as TaskEventListenerCallback,
	// 日志相关
	type LogLevel,
	type TaskLog,
	// MCP 相关
	type McpToolCallParams,
} from "./types"
