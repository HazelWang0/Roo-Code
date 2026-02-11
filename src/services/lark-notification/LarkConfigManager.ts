/**
 * 飞书通知配置管理器
 * 负责读取、监听和管理飞书通知相关的 VSCode 配置
 */

import * as vscode from "vscode"
import { LarkNotificationConfig, TaskNotificationEventType } from "./types"

/**
 * VSCode 配置键名常量
 */
const CONFIG_SECTION = "roo-cline"
const CONFIG_KEYS = {
	enabled: "larkNotification.enabled",
	webhookUrl: "larkNotification.webhookUrl",
	useMcp: "larkNotification.useMcp",
	mcpServerName: "larkNotification.mcpServerName",
	events: "larkNotification.events",
} as const

/**
 * 事件名称到枚举的映射
 */
const EVENT_NAME_MAP: Record<string, TaskNotificationEventType> = {
	task_started: TaskNotificationEventType.TASK_STARTED,
	task_progress: TaskNotificationEventType.TASK_PROGRESS,
	task_completed: TaskNotificationEventType.TASK_COMPLETED,
	task_failed: TaskNotificationEventType.TASK_FAILED,
	task_cancelled: TaskNotificationEventType.TASK_CANCELLED,
}

/**
 * 配置变化监听器类型
 */
export type ConfigChangeListener = (config: LarkNotificationConfig) => void

/**
 * 飞书通知配置管理器
 * 提供配置读取、监听和验证功能
 */
export class LarkConfigManager implements vscode.Disposable {
	private static _instance: LarkConfigManager | null = null
	private disposables: vscode.Disposable[] = []
	private listeners: Set<ConfigChangeListener> = new Set()
	private cachedConfig: LarkNotificationConfig | null = null

	private constructor() {
		// 监听配置变化
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
				if (e.affectsConfiguration(CONFIG_SECTION)) {
					this.invalidateCache()
					this.notifyListeners()
				}
			}),
		)
	}

	/**
	 * 获取单例实例
	 */
	public static getInstance(): LarkConfigManager {
		if (!LarkConfigManager._instance) {
			LarkConfigManager._instance = new LarkConfigManager()
		}
		return LarkConfigManager._instance
	}

	/**
	 * 销毁实例（用于测试）
	 */
	public static destroyInstance(): void {
		if (LarkConfigManager._instance) {
			LarkConfigManager._instance.dispose()
			LarkConfigManager._instance = null
		}
	}

	/**
	 * 获取当前配置
	 */
	public getConfig(): LarkNotificationConfig {
		if (this.cachedConfig) {
			return this.cachedConfig
		}

		const config = vscode.workspace.getConfiguration(CONFIG_SECTION)

		this.cachedConfig = {
			enabled: config.get<boolean>(CONFIG_KEYS.enabled, false),
			webhookUrl: config.get<string>(CONFIG_KEYS.webhookUrl, ""),
			useMcp: config.get<boolean>(CONFIG_KEYS.useMcp, true),
			mcpServerName: config.get<string>(CONFIG_KEYS.mcpServerName, "task-manager"),
			retryCount: 3,
			retryDelay: 1000,
		}

		return this.cachedConfig
	}

	/**
	 * 获取启用的事件类型列表
	 */
	public getEnabledEvents(): TaskNotificationEventType[] {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
		const eventNames = config.get<string[]>(CONFIG_KEYS.events, ["task_started", "task_completed", "task_failed"])

		return eventNames
			.map((name: string) => EVENT_NAME_MAP[name])
			.filter(
				(event: TaskNotificationEventType | undefined): event is TaskNotificationEventType =>
					event !== undefined,
			)
	}

	/**
	 * 检查是否启用飞书通知
	 */
	public isEnabled(): boolean {
		return this.getConfig().enabled
	}

	/**
	 * 检查特定事件是否启用
	 */
	public isEventEnabled(eventType: TaskNotificationEventType): boolean {
		if (!this.isEnabled()) {
			return false
		}
		return this.getEnabledEvents().includes(eventType)
	}

	/**
	 * 验证配置是否有效
	 */
	public validateConfig(): { valid: boolean; errors: string[] } {
		const config = this.getConfig()
		const errors: string[] = []

		if (config.enabled) {
			if (!config.useMcp && !config.webhookUrl) {
				errors.push("Webhook URL is required when not using MCP")
			}

			if (config.useMcp && !config.mcpServerName) {
				errors.push("MCP server name is required when using MCP")
			}

			if (config.webhookUrl && !this.isValidUrl(config.webhookUrl)) {
				errors.push("Invalid webhook URL format")
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		}
	}

	/**
	 * 更新配置（写入 VSCode 设置）
	 */
	public async updateConfig(updates: Partial<LarkNotificationConfig>): Promise<void> {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION)

		if (updates.enabled !== undefined) {
			await config.update(CONFIG_KEYS.enabled, updates.enabled, vscode.ConfigurationTarget.Global)
		}

		if (updates.webhookUrl !== undefined) {
			await config.update(CONFIG_KEYS.webhookUrl, updates.webhookUrl, vscode.ConfigurationTarget.Global)
		}

		if (updates.useMcp !== undefined) {
			await config.update(CONFIG_KEYS.useMcp, updates.useMcp, vscode.ConfigurationTarget.Global)
		}

		if (updates.mcpServerName !== undefined) {
			await config.update(CONFIG_KEYS.mcpServerName, updates.mcpServerName, vscode.ConfigurationTarget.Global)
		}

		this.invalidateCache()
	}

	/**
	 * 更新启用的事件列表
	 */
	public async updateEnabledEvents(events: TaskNotificationEventType[]): Promise<void> {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION)

		// 将枚举转换回字符串
		const eventNames = events
			.map((event: TaskNotificationEventType) => {
				const entry = Object.entries(EVENT_NAME_MAP).find(([, value]) => value === event)
				return entry ? entry[0] : null
			})
			.filter((name: string | null): name is string => name !== null)

		await config.update(CONFIG_KEYS.events, eventNames, vscode.ConfigurationTarget.Global)
	}

	/**
	 * 添加配置变化监听器
	 */
	public onConfigChange(listener: ConfigChangeListener): vscode.Disposable {
		this.listeners.add(listener)
		return {
			dispose: () => {
				this.listeners.delete(listener)
			},
		}
	}

	/**
	 * 清除缓存
	 */
	private invalidateCache(): void {
		this.cachedConfig = null
	}

	/**
	 * 通知所有监听器
	 */
	private notifyListeners(): void {
		const config = this.getConfig()
		for (const listener of this.listeners) {
			try {
				listener(config)
			} catch (error) {
				console.error("Error in config change listener:", error)
			}
		}
	}

	/**
	 * 验证 URL 格式
	 */
	private isValidUrl(url: string): boolean {
		try {
			new URL(url)
			return true
		} catch {
			return false
		}
	}

	/**
	 * 释放资源
	 */
	public dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.listeners.clear()
		this.cachedConfig = null
	}
}

/**
 * 便捷函数：获取配置管理器实例
 */
export function getLarkConfigManager(): LarkConfigManager {
	return LarkConfigManager.getInstance()
}
