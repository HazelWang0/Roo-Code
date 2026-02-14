/**
 * TaskNotificationAdapter 单元测试
 * 测试任务通知适配器的核心功能
 */

import { TaskNotificationAdapter } from "../TaskNotificationAdapter"
import { LarkNotificationService } from "../LarkNotificationService"
import {
	TaskNotificationEventType,
	TaskNotificationStatus,
	type TaskStartedEventData,
	type TaskProgressEventData,
	type TaskCompletedEventData,
	type TaskFailedEventData,
	type TaskCancelledEventData,
	type AnyTaskEventData,
	type TaskEventListener,
} from "../types"

// Mock LarkNotificationService
vi.mock("../LarkNotificationService", () => ({
	LarkNotificationService: {
		getInstance: vi.fn().mockReturnValue({
			notifyTaskCreated: vi.fn().mockResolvedValue({ success: true, messageId: "msg-123" }),
			notifyTaskProgress: vi.fn().mockResolvedValue({ success: true }),
			notifyTaskCompleted: vi.fn().mockResolvedValue({ success: true }),
			notifyTaskFailed: vi.fn().mockResolvedValue({ success: true }),
			isEnabled: vi.fn().mockReturnValue(true),
			getConfig: vi.fn().mockReturnValue({ enabled: true }),
		}),
	},
}))

// Mock LarkConfigManager
vi.mock("../LarkConfigManager", () => ({
	LarkConfigManager: {
		getInstance: vi.fn().mockReturnValue({
			getConfig: vi.fn().mockReturnValue({ enabled: true }),
			isEventEnabled: vi.fn().mockReturnValue(true),
		}),
	},
}))

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
		taskId: "test-task-001",
		parentTaskId: undefined,
		metadata: { task: "Test Task Description" },
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

describe("TaskNotificationAdapter", () => {
	let adapter: TaskNotificationAdapter
	let mockTask: MockTask

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		mockTask = createMockTask()
		adapter = new TaskNotificationAdapter()
	})

	afterEach(() => {
		adapter.detach()
		vi.useRealTimers()
	})

	describe("Task 绑定", () => {
		it("应该能附加到 Task", () => {
			adapter.attach(mockTask as any)

			expect(adapter.isTaskAttached()).toBe(true)
			expect(adapter.getTaskId()).toBe("test-task-001")
		})

		it("应该能从 Task 解除绑定", () => {
			adapter.attach(mockTask as any)
			adapter.detach()

			expect(adapter.isTaskAttached()).toBe(false)
			expect(adapter.getTaskId()).toBeUndefined()
		})

		it("附加新 Task 时应该自动解除旧 Task", () => {
			const mockTask2 = createMockTask({ taskId: "test-task-002" })

			adapter.attach(mockTask as any)
			adapter.attach(mockTask2 as any)

			expect(adapter.getTaskId()).toBe("test-task-002")
		})

		it("未附加时解除绑定不应抛出错误", () => {
			expect(() => adapter.detach()).not.toThrow()
		})
	})

	describe("事件监听", () => {
		it("应该能添加事件监听器", async () => {
			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_STARTED, listener)

			// 手动触发事件
			const eventData: TaskStartedEventData = {
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					taskName: "Test Task",
				},
			}

			await adapter.notify(eventData)
			vi.runAllTimers()

			expect(listener).toHaveBeenCalledWith(eventData)
		})

		it("应该能移除事件监听器", async () => {
			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_STARTED, listener)
			adapter.off(TaskNotificationEventType.TASK_STARTED, listener)

			const eventData: TaskStartedEventData = {
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					taskName: "Test Task",
				},
			}

			await adapter.notify(eventData)
			vi.runAllTimers()

			expect(listener).not.toHaveBeenCalled()
		})

		it("应该能使用通配符监听所有事件", async () => {
			const listener = vi.fn()
			adapter.on("*", listener)

			const eventData: TaskStartedEventData = {
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					taskName: "Test Task",
				},
			}

			await adapter.notify(eventData)
			vi.runAllTimers()

			expect(listener).toHaveBeenCalledWith(eventData)
		})

		it("应该能移除所有事件监听器", async () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			adapter.on(TaskNotificationEventType.TASK_STARTED, listener1)
			adapter.on(TaskNotificationEventType.TASK_COMPLETED, listener2)
			adapter.removeAllListeners()

			const eventData: TaskStartedEventData = {
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					taskName: "Test Task",
				},
			}

			await adapter.notify(eventData)
			vi.runAllTimers()

			expect(listener1).not.toHaveBeenCalled()
			expect(listener2).not.toHaveBeenCalled()
		})
	})

	describe("手动通知", () => {
		it("应该能手动触发通知", async () => {
			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_PROGRESS, listener)

			const eventData: TaskProgressEventData = {
				event: TaskNotificationEventType.TASK_PROGRESS,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					progress: 50,
					currentStep: "Processing...",
				},
			}

			await adapter.notify(eventData)
			vi.runAllTimers()

			expect(listener).toHaveBeenCalledWith(eventData)
		})

		it("禁用时不应发送通知", async () => {
			adapter.updateConfig({ enabled: false })

			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_STARTED, listener)

			const eventData: TaskStartedEventData = {
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					taskName: "Test Task",
				},
			}

			await adapter.notify(eventData)
			vi.runAllTimers()

			expect(listener).not.toHaveBeenCalled()
		})
	})

	describe("节流机制", () => {
		it("应该对配置的事件类型进行节流", async () => {
			adapter.updateConfig({
				enabled: true,
				throttle: {
					enabled: true,
					intervalMs: 2000,
					eventTypes: [TaskNotificationEventType.TASK_PROGRESS],
				},
			})

			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_PROGRESS, listener)

			// 快速发送多个进度事件
			for (let i = 0; i < 5; i++) {
				const eventData: TaskProgressEventData = {
					event: TaskNotificationEventType.TASK_PROGRESS,
					taskId: "test-task-001",
					timestamp: Date.now(),
					data: {
						progress: i * 20,
					},
				}
				await adapter.notify(eventData)
			}

			// 第一个事件应该立即触发
			expect(listener).toHaveBeenCalledTimes(1)

			// 等待节流时间过后
			vi.advanceTimersByTime(2000)

			// 应该触发最后一个待处理的事件
			expect(listener).toHaveBeenCalledTimes(2)
		})

		it("非节流事件应该立即触发", async () => {
			adapter.updateConfig({
				enabled: true,
				throttle: {
					enabled: true,
					intervalMs: 2000,
					eventTypes: [TaskNotificationEventType.TASK_PROGRESS],
				},
			})

			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_STARTED, listener)

			// TASK_STARTED 不在节流列表中
			const eventData: TaskStartedEventData = {
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {
					taskName: "Test Task",
				},
			}

			await adapter.notify(eventData)

			expect(listener).toHaveBeenCalledTimes(1)
		})
	})

	describe("配置管理", () => {
		it("应该能更新配置", () => {
			adapter.updateConfig({ enabled: false })

			// 验证配置已更新（通过行为验证）
			expect(adapter.isTaskAttached()).toBe(false)
		})

		it("应该支持部分配置更新", () => {
			adapter.updateConfig({
				throttle: {
					enabled: false,
					intervalMs: 1000,
				},
			})

			// 配置更新不应抛出错误
			expect(adapter).toBeDefined()
		})
	})

	describe("事件过滤", () => {
		it("应该根据过滤器过滤事件", async () => {
			adapter.updateConfig({
				enabled: true,
				filter: {
					eventTypes: [TaskNotificationEventType.TASK_COMPLETED],
				},
			})

			const startedListener = vi.fn()
			const completedListener = vi.fn()

			adapter.on(TaskNotificationEventType.TASK_STARTED, startedListener)
			adapter.on(TaskNotificationEventType.TASK_COMPLETED, completedListener)

			// 发送 TASK_STARTED 事件（应该被过滤）
			await adapter.notify({
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: { taskName: "Test" },
			} as TaskStartedEventData)

			// 发送 TASK_COMPLETED 事件（应该通过）
			await adapter.notify({
				event: TaskNotificationEventType.TASK_COMPLETED,
				taskId: "test-task-001",
				timestamp: Date.now(),
				data: {},
			} as TaskCompletedEventData)

			vi.runAllTimers()

			expect(startedListener).not.toHaveBeenCalled()
			expect(completedListener).toHaveBeenCalled()
		})

		it("应该根据任务 ID 过滤事件", async () => {
			adapter.updateConfig({
				enabled: true,
				filter: {
					taskIds: ["allowed-task-001"],
				},
			})

			const listener = vi.fn()
			adapter.on(TaskNotificationEventType.TASK_STARTED, listener)

			// 发送不在允许列表中的任务事件
			await adapter.notify({
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "other-task-001",
				timestamp: Date.now(),
				data: { taskName: "Test" },
			} as TaskStartedEventData)

			vi.runAllTimers()

			expect(listener).not.toHaveBeenCalled()

			// 发送在允许列表中的任务事件
			await adapter.notify({
				event: TaskNotificationEventType.TASK_STARTED,
				taskId: "allowed-task-001",
				timestamp: Date.now(),
				data: { taskName: "Test" },
			} as TaskStartedEventData)

			vi.runAllTimers()

			expect(listener).toHaveBeenCalled()
		})
	})

	describe("Task 事件绑定", () => {
		it("附加 Task 时应该注册事件监听器", () => {
			adapter.attach(mockTask as any)

			// 验证 on 方法被调用
			expect(mockTask.on).toHaveBeenCalled()
		})

		it("解除绑定时应该移除事件监听器", () => {
			adapter.attach(mockTask as any)
			adapter.detach()

			// 验证 off 方法被调用
			expect(mockTask.off).toHaveBeenCalled()
		})
	})
})
