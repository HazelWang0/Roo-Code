/**
 * 真实飞书消息发送测试脚本
 *
 * 使用方法:
 * cd third-party/Roo-Code-modify/src && npx tsx services/lark-notification/__tests__/real-lark-test.ts
 */

// 飞书 API 端点
const LARK_API = {
	TENANT_ACCESS_TOKEN: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
	SEND_MESSAGE: "https://open.feishu.cn/open-apis/im/v1/messages",
}

// 配置 - 从 .env 文件读取或使用默认值
const CONFIG = {
	appId: process.env.LARK_APP_ID || "cli_a9f5abe8f0789cb3",
	appSecret: process.env.LARK_APP_SECRET || "O0SvCTGGLLmYyN3VnW1jgbDdCE6dktwK",
	chatId: process.env.LARK_CHAT_ID || "oc_530554a19793ddd18b5ded888fec6cb6",
}

interface TenantAccessTokenResponse {
	code: number
	msg: string
	tenant_access_token?: string
	expire?: number
}

interface SendMessageResponse {
	code: number
	msg: string
	data?: {
		message_id: string
	}
}

async function getTenantAccessToken(): Promise<string> {
	console.log("\n📡 正在获取 tenant_access_token...")
	console.log(`   App ID: ${CONFIG.appId}`)

	const response = await fetch(LARK_API.TENANT_ACCESS_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			app_id: CONFIG.appId,
			app_secret: CONFIG.appSecret,
		}),
	})

	if (!response.ok) {
		throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
	}

	const result = (await response.json()) as TenantAccessTokenResponse
	console.log(`   响应: code=${result.code}, msg=${result.msg}`)

	if (result.code !== 0 || !result.tenant_access_token) {
		throw new Error(`获取 token 失败: ${result.code} - ${result.msg}`)
	}

	console.log(`   ✅ Token 获取成功`)
	return result.tenant_access_token
}

function buildTaskCard(taskId: string, title: string, status: string, progress: number): object {
	const progressBar = "█".repeat(Math.floor(progress / 10)) + "░".repeat(10 - Math.floor(progress / 10))

	return {
		config: { wide_screen_mode: true },
		header: {
			title: { tag: "plain_text", content: `🔔 任务通知: ${title}` },
			template: status === "completed" ? "green" : status === "failed" ? "red" : "blue",
		},
		elements: [
			{
				tag: "div",
				fields: [
					{ is_short: true, text: { tag: "lark_md", content: `**任务ID**\n${taskId}` } },
					{ is_short: true, text: { tag: "lark_md", content: `**状态**\n${status}` } },
				],
			},
			{ tag: "div", text: { tag: "lark_md", content: `**进度** ${progress}%\n\`${progressBar}\`` } },
			{ tag: "hr" },
			{
				tag: "note",
				elements: [
					{ tag: "plain_text", content: `发送时间: ${new Date().toLocaleString("zh-CN")} | Roo Code 测试` },
				],
			},
		],
	}
}

async function sendMessage(token: string, content: object): Promise<string> {
	console.log("\n📤 正在发送消息...")
	console.log(`   Chat ID: ${CONFIG.chatId}`)

	const response = await fetch(`${LARK_API.SEND_MESSAGE}?receive_id_type=chat_id`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			receive_id: CONFIG.chatId,
			msg_type: "interactive",
			content: JSON.stringify(content),
		}),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`HTTP 错误: ${response.status}\n${text}`)
	}

	const result = (await response.json()) as SendMessageResponse
	console.log(`   响应: code=${result.code}, msg=${result.msg}`)

	if (result.code !== 0) {
		throw new Error(`发送失败: ${result.code} - ${result.msg}`)
	}

	console.log(`   ✅ 消息发送成功，message_id: ${result.data?.message_id}`)
	return result.data?.message_id || ""
}

async function main() {
	console.log("=".repeat(50))
	console.log("🚀 飞书消息发送真实测试")
	console.log("=".repeat(50))

	try {
		const token = await getTenantAccessToken()
		const taskId = `test-${Date.now()}`
		const card = buildTaskCard(taskId, "Roo Code 飞书通知测试", "running", 50)
		await sendMessage(token, card)
		console.log("\n✅ 测试完成！请检查飞书群是否收到消息。")
	} catch (error) {
		console.error("\n❌ 测试失败:", error)
		process.exit(1)
	}
}

main()
