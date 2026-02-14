/**
 * LarkNotificationService 单元测试
 * 测试飞书通知服务的核心功能
 */

import { LarkNotificationService } from "../LarkNotificationService"
import { TaskNotificationStatus, type TaskNotificationData, type LarkNotificationConfig } from "../types"

// Mock LarkConfigManager
vi.mock("../LarkConfigManager", () => ({
	LarkConfigManager: {
		getInstance: vi.fn().mockReturnValue({
			getConfig: vi.fn().mockReturnValue({
				enabled: true,
				useMcp: true,
				mcpServerName: "task-manager",
				webhookUrl: "",
				retryCount: 3,
				retryDelay: 100,
			}),
			onConfigChange: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
		}),
	},
}))

// Mock global fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch as typeof fetch

describe("LarkNotificationService", () => {
	beforeEach(() => {
		// 重置单例实例
		LarkNotificationService.resetInstance()
		// 重置 mock
		vi.clearAllMocks()
		mockFetch.mockReset()
	})

	afterEach(() => {
		LarkNotificationService.resetInstance()
	})

	describe("单例模式", () => {
		it("应该返回相同的实例", () => {
			const instance1 = LarkNotificationService.getInstance()
			const instance2 = LarkNotificationService.getInstance()

			expect(instance1).toBe(instance2)
		})

		it("resetInstance 后应该创建新实例", () => {
			const instance1 = LarkNotificationService.getInstance()
			LarkNotificationService.resetInstance()
			const instance2 = LarkNotificationService.getInstance()

			expect(instance1).not.toBe(instance2)
		})

		it("应该支持传入初始配置", () => {
			const config: Partial<LarkNotificationConfig> = {
				enabled: true,
				webhookUrl: "https://example.com/webhook",
			}
			const instance = LarkNotificationService.getInstance(config)

			expect(instance).toBeDefined()
		})
	})

	describe("初始化", () => {
		it("应该正确初始化服务", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize()

			// 验证服务已初始化（通过配置检查）
			const config = service.getConfig()
			expect(config).toBeDefined()
		})

		it("应该支持配置覆盖", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ enabled: false }, false)

			const config = service.getConfig()
			expect(config.enabled).toBe(false)
		})
	})

	describe("配置管理", () => {
		it("应该能获取当前配置", () => {
			const service = LarkNotificationService.getInstance()
			const config = service.getConfig()

			expect(config).toBeDefined()
			expect(config.useMcp).toBeDefined()
		})

		it("应该能更新配置", () => {
			const service = LarkNotificationService.getInstance()
			service.updateConfig({ enabled: false })

			const config = service.getConfig()
			expect(config.enabled).toBe(false)
		})

		it("isEnabled 应该返回正确的状态", () => {
			const service = LarkNotificationService.getInstance()
			service.updateConfig({ enabled: true })

			expect(service.isEnabled()).toBe(true)

			service.updateConfig({ enabled: false })
			expect(service.isEnabled()).toBe(false)
		})
	})

	describe("MCP 工具调用器", () => {
		it("应该能设置 MCP 工具调用器", () => {
			const service = LarkNotificationService.getInstance()
			const mockCaller = vi.fn().mockResolvedValue({ messageId: "test-id" })

			// 设置调用器不应抛出错误
			expect(() => service.setMcpToolCaller(mockCaller)).not.toThrow()
		})
	})

	describe("通知发送 - MCP 模式", () => {
		it("应该通过 MCP 发送任务创建通知", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ useMcp: true, mcpServerName: "task-manager", enabled: true }, false)

			const mockCaller = vi.fn().mockResolvedValue({ messageId: "mcp-msg-123" })
			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(true)
			expect(result.messageId).toBe("mcp-msg-123")
			expect(mockCaller).toHaveBeenCalledWith(
				"task-manager",
				"create_coding_task",
				expect.objectContaining({
					title: "Test Task",
				}),
			)
		})

		it("未设置 MCP 调用器时应该返回错误", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ useMcp: true, enabled: true }, false)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(false)
			expect(result.error).toContain("MCP tool caller not set")
		})

		it("应该发送任务进度更新通知", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ useMcp: true, mcpServerName: "task-manager", enabled: true }, false)

			const mockCaller = vi.fn().mockResolvedValue({ messageId: "msg-123" })
			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.IN_PROGRESS,
				progress: 50,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskProgress(data)

			expect(result.success).toBe(true)
			expect(mockCaller).toHaveBeenCalledWith("task-manager", "update_task_progress", expect.any(Object))
		})

		it("应该发送任务完成通知", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ useMcp: true, mcpServerName: "task-manager", enabled: true }, false)

			const mockCaller = vi.fn().mockResolvedValue({ messageId: "msg-123" })
			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.COMPLETED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCompleted(data)

			expect(result.success).toBe(true)
		})

		it("应该发送任务失败通知", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ useMcp: true, mcpServerName: "task-manager", enabled: true }, false)

			const mockCaller = vi.fn().mockResolvedValue({ messageId: "msg-123" })
			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.FAILED,
				error: "Something went wrong",
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskFailed(data)

			expect(result.success).toBe(true)
		})
	})

	describe("通知发送 - Webhook 模式", () => {
		it("应该通过 Webhook 发送通知", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					webhookUrl: "https://open.feishu.cn/webhook/test",
					enabled: true,
				},
				false,
			)

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: { message_id: "webhook-msg-123" } }),
			} as Response)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(true)
			expect(result.messageId).toBe("webhook-msg-123")
			expect(mockFetch).toHaveBeenCalledWith(
				"https://open.feishu.cn/webhook/test",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
				}),
			)
		})

		it("Webhook 请求失败时应该返回错误", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					webhookUrl: "https://open.feishu.cn/webhook/test",
					enabled: true,
					retryCount: 1,
				},
				false,
			)

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			} as Response)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(false)
			expect(result.error).toContain("500")
		})

		it("未配置 Webhook URL 时应该返回错误", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					webhookUrl: "",
					enabled: true,
					retryCount: 1,
				},
				false,
			)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(false)
			expect(result.error).toContain("No notification method configured")
		})
	})

	describe("应用机器人发送", () => {
		it("应该通过应用机器人成功发送通知", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					botType: "app" as any,
					appBot: {
						appId: "test-app-id",
						appSecret: "test-app-secret",
						chatId: "test-chat-id",
					},
					enabled: true,
					retryCount: 1,
				},
				false,
			)

			// Mock token 请求
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 0,
						tenant_access_token: "test-token",
						expire: 7200,
					}),
				} as Response)
				// Mock 发送消息请求
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 0,
						data: { message_id: "app-msg-123" },
					}),
				} as Response)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(true)
			expect(result.messageId).toBe("app-msg-123")
			expect(mockFetch).toHaveBeenCalledTimes(2)
		})

		it("获取 token 失败时应该返回错误", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					botType: "app" as any,
					appBot: {
						appId: "test-app-id",
						appSecret: "test-app-secret",
						chatId: "test-chat-id",
					},
					enabled: true,
					retryCount: 1,
				},
				false,
			)

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					code: 99991663,
					msg: "app_id or app_secret error",
				}),
			} as Response)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(false)
			expect(result.error).toContain("Lark auth error")
		})

		it("发送消息失败时应该返回错误", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					botType: "app" as any,
					appBot: {
						appId: "test-app-id",
						appSecret: "test-app-secret",
						chatId: "test-chat-id",
					},
					enabled: true,
					retryCount: 1,
				},
				false,
			)

			// Mock token 请求成功
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 0,
						tenant_access_token: "test-token",
						expire: 7200,
					}),
				} as Response)
				// Mock 发送消息失败
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 230001,
						msg: "chat not found",
					}),
				} as Response)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(false)
			expect(result.error).toContain("Lark API error")
		})

		it("应该缓存 token 并复用", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: false,
					botType: "app" as any,
					appBot: {
						appId: "test-app-id",
						appSecret: "test-app-secret",
						chatId: "test-chat-id",
					},
					enabled: true,
					retryCount: 1,
				},
				false,
			)

			// 第一次请求：获取 token + 发送消息
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 0,
						tenant_access_token: "test-token",
						expire: 7200,
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 0,
						data: { message_id: "msg-1" },
					}),
				} as Response)
				// 第二次请求：只发送消息（复用 token）
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						code: 0,
						data: { message_id: "msg-2" },
					}),
				} as Response)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			// 第一次发送
			await service.notifyTaskCreated(data)
			// 第二次发送（应该复用 token）
			await service.notifyTaskProgress({ ...data, status: TaskNotificationStatus.IN_PROGRESS })

			// 应该只请求一次 token（2 次 token + 2 次消息 = 3 次，因为第二次复用 token）
			expect(mockFetch).toHaveBeenCalledTimes(3)
		})
	})

	describe("重试机制", () => {
		it("应该在失败后重试", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: true,
					mcpServerName: "task-manager",
					enabled: true,
					retryCount: 3,
					retryDelay: 10,
				},
				false,
			)

			const mockCaller = vi
				.fn()
				.mockRejectedValueOnce(new Error("First attempt failed"))
				.mockRejectedValueOnce(new Error("Second attempt failed"))
				.mockResolvedValueOnce({ messageId: "success-msg" })

			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(true)
			expect(mockCaller).toHaveBeenCalledTimes(3)
		})

		it("所有重试失败后应该返回错误", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize(
				{
					useMcp: true,
					mcpServerName: "task-manager",
					enabled: true,
					retryCount: 2,
					retryDelay: 10,
				},
				false,
			)

			const mockCaller = vi.fn().mockRejectedValue(new Error("Always fails"))
			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(false)
			expect(mockCaller).toHaveBeenCalledTimes(2)
		})
	})

	describe("禁用状态", () => {
		it("禁用时应该跳过通知发送", async () => {
			const service = LarkNotificationService.getInstance()
			await service.initialize({ enabled: false }, false)

			const mockCaller = vi.fn()
			service.setMcpToolCaller(mockCaller)

			const data: TaskNotificationData = {
				taskId: "task-001",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			}

			const result = await service.notifyTaskCreated(data)

			expect(result.success).toBe(true)
			expect(mockCaller).not.toHaveBeenCalled()
		})
	})

	describe("任务日志", () => {
		it("应该能添加任务日志", () => {
			const service = LarkNotificationService.getInstance()

			service.addTaskLog("task-001", "info", "Task started")
			service.addTaskLog("task-001", "info", "Processing...")

			const logs = service.getTaskLogs("task-001")

			expect(logs).toHaveLength(2)
			expect(logs[0].message).toBe("Task started")
			expect(logs[1].message).toBe("Processing...")
		})

		it("应该能获取空的日志列表", () => {
			const service = LarkNotificationService.getInstance()

			const logs = service.getTaskLogs("non-existent-task")

			expect(logs).toHaveLength(0)
		})

		it("应该能清除任务日志", () => {
			const service = LarkNotificationService.getInstance()

			service.addTaskLog("task-001", "info", "Task started")
			service.clearTaskLogs("task-001")

			const logs = service.getTaskLogs("task-001")

			expect(logs).toHaveLength(0)
		})

		it("日志应该包含正确的元数据", () => {
			const service = LarkNotificationService.getInstance()

			service.addTaskLog("task-001", "error", "Error occurred", { code: 500 })

			const logs = service.getTaskLogs("task-001")

			expect(logs[0].level).toBe("error")
			expect(logs[0].metadata).toEqual({ code: 500 })
			expect(logs[0].time).toBeDefined()
		})
	})

	describe("事件监听", () => {
		it("应该能添加和移除事件监听器", () => {
			const service = LarkNotificationService.getInstance()
			const listener = vi.fn()

			service.on("notification:sent", listener)
			service.off("notification:sent", listener)

			// 验证不会抛出错误
			expect(service).toBeDefined()
		})
	})

	describe("资源清理", () => {
		it("dispose 应该清理资源", () => {
			const service = LarkNotificationService.getInstance()
			service.addTaskLog("task-001", "info", "Test")

			service.dispose()

			const logs = service.getTaskLogs("task-001")
			expect(logs).toHaveLength(0)
		})
	})
})
