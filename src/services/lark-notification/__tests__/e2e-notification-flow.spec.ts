/**
 * 端到端集成测试：飞书通知流程
 *
 * 测试目标：验证从 Task 事件触发到飞书通知发送的完整流程
 *
 * 诊断假设：
 * 1. LarkNotificationService.initialize() 从未被调用
 * 2. 导致服务使用默认配置 enabled: false
 * 3. 所有通知在 sendNotification() 方法的第一个检查点被跳过
 */

import { TaskEventListener } from "../TaskEventListener"
import { TaskNotificationAdapter } from "../TaskNotificationAdapter"
import { LarkNotificationService } from "../LarkNotificationService"
import { LarkConfigManager } from "../LarkConfigManager"
import { LarkBotType, TaskNotificationEventType, TaskNotificationStatus } from "../types"

// Mock vscode 模块
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn((key: string, defaultValue: unknown) => {
				// 模拟用户已配置飞书通知
				const configMap: Record<string, unknown> = {
					"larkNotification.enabled": true,
					"larkNotification.botType": "app",
					"larkNotification.appId": "cli_test_app_id",
					"larkNotification.appSecret": "test_app_secret",
					"larkNotification.chatId": "oc_test_chat_id",
					"larkNotification.useMcp": false, // 不使用 MCP，直接使用 App Bot
					"larkNotification.mcpServerName": "task-manager",
					"larkNotification.events": ["task_started", "task_completed", "task_failed"],
				}
				return configMap[key] ?? defaultValue
			}),
			update: vi.fn().mockResolvedValue(undefined),
		}),
		onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
}))

// Mock fetch 用于拦截 API 调用
const mockFetch = vi.fn()
global.fetch = mockFetch

// 创建模拟的 Task 对象
interface MockTask {
	taskId: string
	parentTaskId?: string
	metadata?: { task?: string }
	on: ReturnType<typeof vi.fn>
	off: ReturnType<typeof vi.fn>
	emit: (event: string, ...args: unknown[]) => void
}

function createMockTask(overrides: Partial<MockTask> = {}): MockTask {
	const listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map()

	return {
		taskId: "test-task-e2e-001",
		parentTaskId: undefined,
		metadata: { task: "E2E Test Task" },
		on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
			if (!listeners.has(event)) {
				listeners.set(event, [])
			}
			listeners.get(event)!.push(listener)
		}),
		off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
			const eventListeners = listeners.get(event)
			if (eventListeners) {
				const index = eventListeners.indexOf(listener)
				if (index > -1) {
					eventListeners.splice(index, 1)
				}
			}
		}),
		emit: (event: string, ...args: unknown[]) => {
			const eventListeners = listeners.get(event)
			if (eventListeners) {
				eventListeners.forEach((listener) => listener(...args))
			}
		},
		...overrides,
	}
}

describe("E2E: 飞书通知流程诊断测试", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		// 重置所有单例
		LarkNotificationService.resetInstance()
		TaskEventListener.resetInstance()
		LarkConfigManager.destroyInstance()

		// 模拟成功的 API 响应
		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					code: 0,
					msg: "success",
					tenant_access_token: "test_token",
					expire: 7200,
					data: { message_id: "msg_test_123" },
				}),
		})
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("问题诊断：LarkNotificationService 未初始化", () => {
		it("应该验证 LarkNotificationService 默认配置 enabled 为 false", () => {
			// 直接获取 LarkNotificationService 实例（不调用 initialize）
			const service = LarkNotificationService.getInstance()
			const config = service.getConfig()

			// 验证默认配置
			expect(config.enabled).toBe(false)
			expect(config.useMcp).toBe(true)
			expect(config.botType).toBe(LarkBotType.WEBHOOK)
		})

		// 修复后此测试不再适用 - TaskEventListener 现在会调用 initialize()
		it.skip("应该验证 TaskEventListener 创建时不会调用 LarkNotificationService.initialize()", async () => {
			// 监视 initialize 方法
			const initializeSpy = vi.spyOn(LarkNotificationService.prototype, "initialize")

			// 创建 TaskEventListener 实例
			const listener = TaskEventListener.getInstance()

			// 等待任何异步操作完成
			await new Promise((resolve) => setTimeout(resolve, 100))

			// 验证 initialize 从未被调用
			expect(initializeSpy).not.toHaveBeenCalled()

			// 验证 LarkNotificationService 仍使用默认配置
			const service = LarkNotificationService.getInstance()
			expect(service.getConfig().enabled).toBe(false)
		})

		it("应该验证当 enabled=false 时通知被跳过", async () => {
			const service = LarkNotificationService.getInstance()
			// 不调用 initialize，保持默认 enabled: false

			const result = await service.notifyTaskCreated({
				taskId: "test-task",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			})

			// 通知应该被跳过但返回成功（因为是静默跳过）
			expect(result.success).toBe(true)
			expect(result.messageId).toBeUndefined()

			// fetch 不应该被调用
			expect(mockFetch).not.toHaveBeenCalled()
		})

		// 修复后此测试不再适用 - 通知现在会正常发送
		it.skip("应该验证完整的 Task -> TaskEventListener -> LarkNotificationService 流程中通知被跳过", async () => {
			// 创建 TaskEventListener（不会初始化 LarkNotificationService）
			const listener = TaskEventListener.getInstance()

			// 创建模拟 Task
			const mockTask = createMockTask()

			// 注册任务
			const adapter = listener.registerTask(mockTask as any)

			// 等待任务开始事件处理
			await new Promise((resolve) => setTimeout(resolve, 100))

			// 验证 fetch 没有被调用（因为 enabled=false）
			expect(mockFetch).not.toHaveBeenCalled()

			// 清理
			listener.unregisterTask(mockTask.taskId)
		})
	})

	describe("修复验证：调用 initialize() 后通知应该正常发送", () => {
		it("应该验证调用 initialize() 后配置被正确同步", async () => {
			const service = LarkNotificationService.getInstance()

			// 调用 initialize
			await service.initialize()

			const config = service.getConfig()

			// 验证配置已从 ConfigManager 同步
			expect(config.enabled).toBe(true)
			expect(config.botType).toBe(LarkBotType.APP)
			expect(config.appBot).toBeDefined()
			expect(config.appBot?.appId).toBe("cli_test_app_id")
			expect(config.appBot?.appSecret).toBe("test_app_secret")
			expect(config.appBot?.chatId).toBe("oc_test_chat_id")
			expect(config.useMcp).toBe(false)
		})

		it("应该验证调用 initialize() 后通知能够正常发送", async () => {
			const service = LarkNotificationService.getInstance()

			// 调用 initialize
			await service.initialize()

			// 发送通知
			const result = await service.notifyTaskCreated({
				taskId: "test-task",
				taskName: "Test Task",
				status: TaskNotificationStatus.CREATED,
				timestamp: Date.now(),
			})

			// 验证通知发送成功
			expect(result.success).toBe(true)

			// 验证 fetch 被调用（获取 token + 发送消息）
			expect(mockFetch).toHaveBeenCalled()
		})
	})

	describe("修复方案验证：TaskEventListener 应该初始化 LarkNotificationService", () => {
		it("修复后：TaskEventListener 创建时应该调用 LarkNotificationService.initialize()", async () => {
			// 这个测试在修复前会失败，修复后应该通过

			// 监视 initialize 方法
			const initializeSpy = vi.spyOn(LarkNotificationService.prototype, "initialize")

			// 重置单例以确保干净的状态
			LarkNotificationService.resetInstance()
			TaskEventListener.resetInstance()

			// 创建 TaskEventListener 实例
			const listener = TaskEventListener.getInstance()

			// 等待异步初始化完成
			await new Promise((resolve) => setTimeout(resolve, 200))

			// 修复后，initialize 应该被调用
			// 注意：这个断言在修复前会失败
			expect(initializeSpy).toHaveBeenCalled()
		})

		it("修复后：完整流程应该能够发送飞书通知", async () => {
			// 重置单例
			LarkNotificationService.resetInstance()
			TaskEventListener.resetInstance()
			LarkConfigManager.destroyInstance()

			// 创建 TaskEventListener（修复后会自动初始化 LarkNotificationService）
			const listener = TaskEventListener.getInstance()

			// 等待初始化完成
			await new Promise((resolve) => setTimeout(resolve, 200))

			// 创建模拟 Task
			const mockTask = createMockTask()

			// 注册任务
			listener.registerTask(mockTask as any)

			// 等待任务开始事件处理
			await new Promise((resolve) => setTimeout(resolve, 200))

			// 修复后，fetch 应该被调用
			// 注意：这个断言在修复前会失败
			expect(mockFetch).toHaveBeenCalled()

			// 清理
			listener.unregisterTask(mockTask.taskId)
		})
	})
})
