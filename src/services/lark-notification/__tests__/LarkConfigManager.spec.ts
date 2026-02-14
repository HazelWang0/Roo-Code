/**
 * LarkConfigManager 单元测试
 * 测试配置管理器的核心功能
 */

import type { ConfigurationChangeEvent, Disposable, WorkspaceConfiguration } from "vscode"
import { LarkConfigManager, getLarkConfigManager } from "../LarkConfigManager"
import { TaskNotificationEventType, LarkBotType } from "../types"

// 存储配置变化回调
let configChangeCallback: ((e: ConfigurationChangeEvent) => void) | null = null

// Mock 配置存储（在 vi.mock 外部，可以被测试访问）
const mockConfig: Record<string, unknown> = {
	"larkNotification.enabled": false,
	"larkNotification.botType": "webhook",
	"larkNotification.webhookUrl": "",
	"larkNotification.appId": "",
	"larkNotification.appSecret": "",
	"larkNotification.chatId": "",
	"larkNotification.useMcp": true,
	"larkNotification.mcpServerName": "task-manager",
	"larkNotification.events": ["task_started", "task_completed", "task_failed"],
}

// 辅助函数：触发配置变化
const triggerConfigChange = (section: string) => {
	if (configChangeCallback) {
		configChangeCallback({
			affectsConfiguration: (s: string) => s === section,
		} as ConfigurationChangeEvent)
	}
}

// 辅助函数：设置 mock 配置
const setMockConfig = (key: string, value: unknown) => {
	mockConfig[key] = value
}

// 辅助函数：重置 mock 配置
const resetMockConfig = () => {
	mockConfig["larkNotification.enabled"] = false
	mockConfig["larkNotification.botType"] = "webhook"
	mockConfig["larkNotification.webhookUrl"] = ""
	mockConfig["larkNotification.appId"] = ""
	mockConfig["larkNotification.appSecret"] = ""
	mockConfig["larkNotification.chatId"] = ""
	mockConfig["larkNotification.useMcp"] = true
	mockConfig["larkNotification.mcpServerName"] = "task-manager"
	mockConfig["larkNotification.events"] = ["task_started", "task_completed", "task_failed"]
}

// Mock vscode 模块
vi.mock("vscode", () => {
	return {
		workspace: {
			getConfiguration: vi.fn().mockImplementation(() => ({
				get: vi.fn().mockImplementation((key: string, defaultValue?: unknown) => {
					const fullKey = `larkNotification.${key.replace("larkNotification.", "")}`
					return mockConfig[fullKey] ?? defaultValue
				}),
				update: vi.fn().mockResolvedValue(undefined),
			})),
			onDidChangeConfiguration: vi.fn().mockImplementation((callback: (e: ConfigurationChangeEvent) => void) => {
				configChangeCallback = callback
				return {
					dispose: vi.fn(),
				}
			}),
		},
		ConfigurationTarget: {
			Global: 1,
			Workspace: 2,
			WorkspaceFolder: 3,
		},
	}
})

// 导入 mocked vscode 用于断言
import * as vscode from "vscode"

describe("LarkConfigManager", () => {
	beforeEach(() => {
		// 重置单例实例
		LarkConfigManager.destroyInstance()
		// 重置 mock 配置
		resetMockConfig()
		// 清除 mock 调用记录
		vi.clearAllMocks()
	})

	afterEach(() => {
		LarkConfigManager.destroyInstance()
	})

	describe("单例模式", () => {
		it("应该返回相同的实例", () => {
			const instance1 = LarkConfigManager.getInstance()
			const instance2 = LarkConfigManager.getInstance()

			expect(instance1).toBe(instance2)
		})

		it("destroyInstance 后应该创建新实例", () => {
			const instance1 = LarkConfigManager.getInstance()
			LarkConfigManager.destroyInstance()
			const instance2 = LarkConfigManager.getInstance()

			expect(instance1).not.toBe(instance2)
		})

		it("getLarkConfigManager 便捷函数应该返回实例", () => {
			const instance = getLarkConfigManager()

			expect(instance).toBeInstanceOf(LarkConfigManager)
		})
	})

	describe("配置读取", () => {
		it("应该返回默认配置", () => {
			const manager = LarkConfigManager.getInstance()
			const config = manager.getConfig()

			expect(config).toEqual({
				enabled: false,
				botType: LarkBotType.WEBHOOK,
				webhookUrl: "",
				appBot: undefined,
				useMcp: true,
				mcpServerName: "task-manager",
				retryCount: 3,
				retryDelay: 1000,
			})
		})

		it("应该缓存配置", () => {
			const manager = LarkConfigManager.getInstance()

			// 第一次调用
			manager.getConfig()
			// 第二次调用
			manager.getConfig()

			// getConfiguration 应该只被调用一次（因为缓存）
			expect(vscode.workspace.getConfiguration).toHaveBeenCalledTimes(1)
		})

		it("isEnabled 应该返回正确的启用状态", () => {
			const manager = LarkConfigManager.getInstance()

			expect(manager.isEnabled()).toBe(false)
		})
	})

	describe("事件配置", () => {
		it("应该返回启用的事件类型列表", () => {
			const manager = LarkConfigManager.getInstance()
			const events = manager.getEnabledEvents()

			expect(events).toContain(TaskNotificationEventType.TASK_STARTED)
			expect(events).toContain(TaskNotificationEventType.TASK_COMPLETED)
			expect(events).toContain(TaskNotificationEventType.TASK_FAILED)
		})

		it("isEventEnabled 应该检查特定事件是否启用", () => {
			const manager = LarkConfigManager.getInstance()

			// 当全局禁用时，所有事件都应该返回 false
			expect(manager.isEventEnabled(TaskNotificationEventType.TASK_STARTED)).toBe(false)
		})
	})

	describe("配置验证", () => {
		it("禁用时应该验证通过", () => {
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(true)
			expect(result.errors).toHaveLength(0)
		})

		it("启用 webhook 机器人但未配置 webhook URL 且不使用 MCP 时应该验证失败", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.botType", "webhook")
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.webhookUrl", "")

			// 需要重新创建实例以获取新配置
			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Webhook URL is required for webhook bot")
		})

		it("启用应用机器人但未配置 appId 时应该验证失败", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.botType", "app")
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.appId", "")
			setMockConfig("larkNotification.appSecret", "test-secret")
			setMockConfig("larkNotification.chatId", "test-chat-id")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(false)
			expect(result.errors).toContain("App ID is required for app bot")
		})

		it("启用应用机器人但未配置 appSecret 时应该验证失败", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.botType", "app")
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.appId", "test-app-id")
			setMockConfig("larkNotification.appSecret", "")
			setMockConfig("larkNotification.chatId", "test-chat-id")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(false)
			expect(result.errors).toContain("App Secret is required for app bot")
		})

		it("启用应用机器人但未配置 chatId 时应该验证失败", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.botType", "app")
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.appId", "test-app-id")
			setMockConfig("larkNotification.appSecret", "test-secret")
			setMockConfig("larkNotification.chatId", "")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Chat ID is required for app bot")
		})

		it("应用机器人配置完整时应该验证通过", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.botType", "app")
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.appId", "test-app-id")
			setMockConfig("larkNotification.appSecret", "test-secret")
			setMockConfig("larkNotification.chatId", "test-chat-id")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(true)
			expect(result.errors).toHaveLength(0)
		})

		it("启用 MCP 但未配置服务器名称时应该验证失败", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.useMcp", true)
			setMockConfig("larkNotification.mcpServerName", "")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(false)
			expect(result.errors).toContain("MCP server name is required when using MCP")
		})

		it("无效的 webhook URL 应该验证失败", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.webhookUrl", "invalid-url")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Invalid webhook URL format")
		})

		it("有效的 webhook URL 应该验证通过", () => {
			setMockConfig("larkNotification.enabled", true)
			setMockConfig("larkNotification.useMcp", false)
			setMockConfig("larkNotification.webhookUrl", "https://open.feishu.cn/webhook/xxx")

			LarkConfigManager.destroyInstance()
			const manager = LarkConfigManager.getInstance()
			const result = manager.validateConfig()

			expect(result.valid).toBe(true)
		})
	})

	describe("配置变化监听", () => {
		it("应该能添加配置变化监听器", () => {
			const manager = LarkConfigManager.getInstance()
			const listener = vi.fn()

			const disposable = manager.onConfigChange(listener)

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})

		it("配置变化时应该通知监听器", () => {
			const manager = LarkConfigManager.getInstance()
			const listener = vi.fn()
			manager.onConfigChange(listener)

			// 触发配置变化
			triggerConfigChange("roo-cline")

			expect(listener).toHaveBeenCalled()
		})

		it("dispose 后不应该再收到通知", () => {
			const manager = LarkConfigManager.getInstance()
			const listener = vi.fn()
			const disposable = manager.onConfigChange(listener)

			// 先 dispose
			disposable.dispose()

			// 再触发配置变化
			triggerConfigChange("roo-cline")

			expect(listener).not.toHaveBeenCalled()
		})

		it("监听器错误不应该影响其他监听器", () => {
			const manager = LarkConfigManager.getInstance()
			const errorListener = vi.fn().mockImplementation(() => {
				throw new Error("Test error")
			})
			const normalListener = vi.fn()

			manager.onConfigChange(errorListener)
			manager.onConfigChange(normalListener)

			// 触发配置变化
			triggerConfigChange("roo-cline")

			// 两个监听器都应该被调用
			expect(errorListener).toHaveBeenCalled()
			expect(normalListener).toHaveBeenCalled()
		})
	})

	describe("配置更新", () => {
		it("应该能更新配置", async () => {
			const manager = LarkConfigManager.getInstance()
			const mockUpdate = vi.fn().mockResolvedValue(undefined)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn(),
				update: mockUpdate,
			} as unknown as WorkspaceConfiguration)

			await manager.updateConfig({ enabled: true })

			expect(mockUpdate).toHaveBeenCalled()
		})

		it("应该能更新启用的事件列表", async () => {
			const manager = LarkConfigManager.getInstance()
			const mockUpdate = vi.fn().mockResolvedValue(undefined)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn(),
				update: mockUpdate,
			} as unknown as WorkspaceConfiguration)

			await manager.updateEnabledEvents([
				TaskNotificationEventType.TASK_STARTED,
				TaskNotificationEventType.TASK_COMPLETED,
			])

			expect(mockUpdate).toHaveBeenCalled()
		})
	})

	describe("资源释放", () => {
		it("dispose 应该清理所有资源", () => {
			const manager = LarkConfigManager.getInstance()
			const listener = vi.fn()
			manager.onConfigChange(listener)

			manager.dispose()

			// 触发配置变化，监听器不应该被调用
			triggerConfigChange("roo-cline")

			expect(listener).not.toHaveBeenCalled()
		})
	})
})
