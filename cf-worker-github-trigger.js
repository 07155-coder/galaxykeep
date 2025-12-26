/**
 * CF Worker GitHub Actions Trigger
 *
 * A powerful Cloudflare Workers script for monitoring website status
 * and automatically triggering GitHub Actions workflows.
 *
 * Features:
 * - Conditional triggers based on HTTP status codes
 * - Scheduled triggers for regular tasks
 * - Intelligent cooldown mechanism
 * - Telegram notifications support
 * - Concurrent task processing
 * - Structured logging
 *
 * GitHub: https://github.com/your-username/cf-worker-github-trigger
 */

export default {
  async scheduled(event, env, ctx) {
    /**
     * ===========================================
     * 任务配置区域 - 这是你需要修改的主要部分
     * ===========================================
     *
     * 支持多个监控任务，每个任务可以独立配置
     * 如果你要监控多个网站，请在这里添加多个任务对象
     */

    const tasks = [
      {
        // 【必填】任务名称，随意填写，用于日志区分不同任务
        name: "网站状态监控",

        // 【条件触发必填】要监控的网站URL，必须是完整的HTTP/HTTPS链接
        // 示例: "https://www.example.com/page", "https://api.example.com/status"
        check_url: "https://example.com/page1",

        // 【条件触发必填】触发工作流的HTTP状态码数组
        // 常见状态码: 404(页面不存在), 500(服务器错误), 502(Bad Gateway), 503(服务不可用)
        // 可以填写多个: [404, 500, 502] 或单个: [404]
        trigger_status_codes: [404],

        // 【必填】GitHub用户名或组织名
        // 示例: 如果你的仓库是 https://github.com/john/repo，那么owner就是"john"
        owner: "your-user",

        // 【必填】GitHub仓库名
        // 示例: 如果你的仓库是 https://github.com/john/repo，那么repo就是"repo"
        repo: "repo-a",

        // 【必填】GitHub Actions工作流文件名
        // 必须是 .github/workflows/ 目录下的文件名
        // 示例: "deploy.yml", "ci.yml", "check-site.yml"
        workflow_id: "check-site.yml",

        // 【必填】GitHub分支名，通常是"main"或"master"
        ref: "main",

        // 【必填】是否启用状态检查
        // true = 条件触发（检查网站状态后决定是否触发）
        // false = 定时触发（每次都触发，不管网站状态）
        enable_check: true,

        // 【选填】冷却时间（毫秒），防止频繁触发
        // 默认60分钟，建议根据你的需求调整
        // 示例: 30分钟 = 30 * 60 * 1000, 2小时 = 2 * 60 * 60 * 1000
        check_interval: 60 * 60 * 1000,

        // 【选填】是否在跳过执行时发送通知
        // true = 发送通知, false = 不发送通知
        // 建议条件触发设为false，定时触发设为true
        notify_on_skip: false,
      },

      {
        // 第二个任务示例：定时备份任务（不检查网站状态）
        name: "定时备份任务",

        // 注意：定时触发模式不需要填写 check_url 和 trigger_status_codes

        // 【必填】GitHub用户名
        owner: "your-user",

        // 【必填】GitHub仓库名
        repo: "repo-b",

        // 【必填】工作流文件名
        workflow_id: "backup.yml",

        // 【必填】分支名
        ref: "main",

        // 【必填】设为false表示定时触发
        enable_check: false,

        // 【选填】定时任务也可以设置冷却时间，防止意外频繁执行
        // check_interval: 24 * 60 * 60 * 1000, // 24小时

        // 【选填】定时任务建议开启跳过通知，便于了解执行情况
        notify_on_skip: true,
      },

      // 如果需要监控更多网站，请复制上面的对象格式，修改相应配置
      // 例如：
      /*
      {
        name: "API状态监控",
        check_url: "https://api.example.com/health",
        trigger_status_codes: [500, 502, 503],
        owner: "your-username",
        repo: "api-monitor",
        workflow_id: "alert.yml",
        ref: "main",
        enable_check: true,
        check_interval: 30 * 60 * 1000, // 30分钟冷却
        notify_on_skip: false,
      }
      */
    ];

    /**
     * ===========================================
     * 环境变量配置 - 在Cloudflare Workers中设置
     * ===========================================
     *
     * 【必须设置的环境变量】
     * GITHUB_TOKEN: GitHub Personal Access Token
     *   - 去 https://github.com/settings/tokens 创建
     *   - 权限: 勾选 "workflow" 权限
     *   - 格式: ghp_xxxxxxxxxxxxxxxxxxxx
     *
     * 【可选的环境变量】(用于Telegram通知)
     * TELEGRAM_BOT_TOKEN: Telegram机器人Token
     *   - 在Telegram中找 @BotFather 创建机器人
     *   - 格式: 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
     *
     * TELEGRAM_CHAT_ID: Telegram聊天ID
     *   - 先给机器人发消息，然后访问 https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates 获取
     *   - 格式: 数字ID，如 123456789
     *
     * 【KV存储绑定】
     * TRIGGER_KV: Cloudflare KV命名空间绑定
     *   - 在Cloudflare Dashboard创建KV命名空间
     *   - 在Worker设置中绑定此命名空间
     */

    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID;

    // 2. 并发限制处理所有任务（最大5个并发，避免资源过载）
    // 如果你有很多任务，可以调整这个数字，但不要设置太大
    const results = await processTasksWithConcurrencyLimit(
      tasks,
      5, // 最大并发数，建议保持在5以内
      async (task) => processTask(task, GITHUB_TOKEN, env.TRIGGER_KV, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
    );

    // 3. 输出汇总结果
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;

    logStructured('SUMMARY', {
      total_tasks: tasks.length,
      successful: successCount,
      failed: failedCount,
      timestamp: new Date().toISOString()
    });

    console.log(`任务执行汇总: 总计${tasks.length}个，成功${successCount}个，失败${failedCount}个`);
  },

  /**
   * ===========================================
   * 手动触发接口 - 可选功能
   * ===========================================
   *
   * 你可以直接访问Worker URL来手动触发所有任务检查
   * 例如: https://your-worker.your-subdomain.workers.dev/
   *
   * 这对于测试配置是否正确很有用
   */
  async fetch(request, env, ctx) {
    await this.scheduled(null, env, ctx);
    return new Response("✅ 工作流触发检查已完成，请查看Worker日志和Telegram通知。");
  }
};

/**
 * 处理单个任务的逻辑
 * 支持两种模式：条件触发（状态检查）和定时触发（无条件）
 */
async function processTask(task, token, kv, telegramToken, telegramChatId) {
  const {
    name,
    check_url,
    trigger_status_codes = [404],
    owner,
    repo,
    workflow_id,
    ref,
    enable_check,
    check_interval = 60 * 60 * 1000,
    notify_on_skip = false
  } = task;

  logStructured('TASK_START', { task_name: name, mode: enable_check ? 'conditional' : 'scheduled' });

  try {
    // 模式1: 条件触发模式（需要状态检查）
    if (enable_check && check_url) {
      logStructured('MODE_CHECK', { task_name: name, check_url });

      // 步骤A: 检查目标链接状态码（带超时控制）
      const response = await fetchWithTimeout(check_url, {
        method: 'GET',
        headers: { 'User-Agent': 'CF-Worker-Monitor' }
      }, 10000); // 10秒超时

      const shouldTrigger = trigger_status_codes.includes(response.status);

      if (!shouldTrigger) {
        logStructured('CHECK_SKIP', {
          task_name: name,
          status_code: response.status,
          trigger_codes: trigger_status_codes
        });

        if (notify_on_skip) {
          // Telegram通知异步执行，不影响主流程
          sendTelegramMessage(telegramToken, telegramChatId,
            `🔍 ${name}\n链接状态正常 (HTTP ${response.status})\n无需触发工作流`)
            .catch(err => console.error(`Telegram通知失败: ${err.message}`));
        }
        return { status: 'skipped', reason: 'status_code_not_trigger' };
      }

      // 步骤B: 检查冷却时间（状态级别）
      const statusKvKey = `last_trigger:${check_url}:${response.status}`;
      const lastTriggered = await kv.get(statusKvKey);
      const now = Date.now();

      if (lastTriggered && (now - parseInt(lastTriggered) < check_interval)) {
        const remaining = Math.round((check_interval - (now - parseInt(lastTriggered))) / 60000);
        logStructured('COOLDOWN_SKIP', { task_name: name, remaining_minutes: remaining });

        if (notify_on_skip) {
          sendTelegramMessage(telegramToken, telegramChatId,
            `⏳ ${name}\n处于冷却期，还需等待 ${remaining} 分钟`)
            .catch(err => console.error(`Telegram通知失败: ${err.message}`));
        }
        return { status: 'skipped', reason: 'cooldown_active' };
      }

      // 步骤C: 触发工作流
      logStructured('TRIGGER_EXECUTE', { task_name: name, status_code: response.status });
      await triggerWorkflow({ owner, repo, workflow_id, ref }, token);

      // 步骤D: 更新KV记录（状态级别）
      await kv.put(statusKvKey, now.toString());

      // Telegram通知异步执行
      sendTelegramMessage(telegramToken, telegramChatId,
        `✅ ${name}\n检测到触发条件 (HTTP ${response.status})\n✅ 工作流已触发：${owner}/${repo}/${workflow_id}`)
        .catch(err => console.error(`Telegram通知失败: ${err.message}`));

      return { status: 'triggered', reason: 'condition_met' };

    } else {
      // 模式2: 定时触发模式（无条件）
      logStructured('SCHEDULED_EXECUTE', { task_name: name });
      await triggerWorkflow({ owner, repo, workflow_id, ref }, token);

      // Telegram通知异步执行
      sendTelegramMessage(telegramToken, telegramChatId,
        `⏰ ${name}\n定时触发\n✅ 工作流已启动：${owner}/${repo}/${workflow_id}`)
        .catch(err => console.error(`Telegram通知失败: ${err.message}`));

      return { status: 'triggered', reason: 'scheduled' };
    }

  } catch (error) {
    logStructured('TASK_ERROR', {
      task_name: name,
      error_type: categorizeError(error),
      error_message: error.message
    });

    // Telegram通知异步执行，不影响返回错误状态
    sendTelegramMessage(telegramToken, telegramChatId,
      `❌ ${name}\n处理失败 [${categorizeError(error)}]：${error.message}`)
      .catch(err => console.error(`Telegram通知失败: ${err.message}`));

    return { status: 'failed', error: error.message, error_type: categorizeError(error) };
  }
}

/**
 * 触发GitHub Actions工作流的函数（带超时和错误分类）
 */
async function triggerWorkflow({ owner, repo, workflow_id, ref }, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "CF-Worker-Trigger",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: {}
    }),
  }, 15000); // GitHub API 15秒超时

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`HTTP ${response.status}: ${errorText}`);
    error.statusCode = response.status;
    throw error;
  }

  return true;
}

/**
 * 带超时的fetch函数
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeoutMs}ms): ${url}`);
    }
    throw error;
  }
}

/**
 * 错误分类函数
 */
function categorizeError(error) {
  if (error.message.includes('HTTP 401') || error.message.includes('HTTP 403')) {
    return 'AUTH_ERROR';
  }
  if (error.message.includes('HTTP 404')) {
    return 'NOT_FOUND';
  }
  if (error.message.includes('HTTP 429')) {
    return 'RATE_LIMIT';
  }
  if (error.message.includes('HTTP 5')) {
    return 'SERVER_ERROR';
  }
  if (error.message.includes('超时')) {
    return 'TIMEOUT';
  }
  if (error.message.includes('网络') || error.message.includes('fetch')) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

/**
 * 结构化日志函数
 */
function logStructured(eventType, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: eventType,
    ...data
  };
  console.log(`[${eventType}]`, JSON.stringify(logEntry));
}

/**
 * 发送Telegram通知的函数
 */
async function sendTelegramMessage(botToken, chatId, message) {
  if (!botToken || !chatId) {
    console.log("Telegram配置缺失，跳过通知");
    return;
  }

  try {
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      }),
    });
  } catch (error) {
    console.error(`Telegram通知失败: ${error.message}`);
  }
}

/**
 * 并发限制的任务处理函数
 */
async function processTasksWithConcurrencyLimit(tasks, concurrencyLimit, taskProcessor) {
  const results = [];
  const executing = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const promise = taskProcessor(task).then(result => {
      results[i] = { status: 'fulfilled', value: result };
      return result;
    }).catch(error => {
      results[i] = { status: 'rejected', reason: error };
      throw error;
    });

    results[i] = promise;
    executing.push(promise);

    // 当达到并发限制时，等待其中一个任务完成
    if (executing.length >= concurrencyLimit) {
      await Promise.race(executing);
      // 移除已完成的任务
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }

  // 等待所有剩余任务完成
  await Promise.allSettled(executing);

  return results;
}

/*
===========================================
📋 详细使用教程（小白专用）
===========================================

【第一步：准备GitHub Token】
1. 打开 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 名称随便填，如 "CF-Worker-Trigger"
4. 权限勾选：repo + workflow
5. 生成后立刻复制保存（只显示一次）
   格式：ghp_xxxxxxxxxxxxxxxxxxxx

【第二步：准备Telegram通知（可选）】
1. 在Telegram搜索 @BotFather，发送 /newbot
2. 按提示创建机器人，获取Token
   格式：1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
3. 给你的机器人发一条消息
4. 访问 https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
5. 找到 "chat":{"id":123456789} 中的数字ID

【第三步：Cloudflare Workers部署】
1. 登录 https://dash.cloudflare.com/
2. 进入 Workers & Pages → Create Worker
3. 粘贴本代码，修改配置
4. 点击 Deploy 部署

【第四步：配置环境变量】
在Worker页面点击 "Settings" → "Variables"：

必须设置：
GITHUB_TOKEN = ghp_xxxxxxxxxxxxxxxxxxxx

可选设置（Telegram通知）：
TELEGRAM_BOT_TOKEN = 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID = 123456789

【第五步：配置KV存储】
1. 在Cloudflare Dashboard进入 Workers & Pages → KV
2. Create namespace，命名如 "trigger-kv"
3. 回到Worker设置 → Variables → KV Namespace Bindings
4. 添加绑定：Variable name = TRIGGER_KV，KV namespace = 刚才创建的

【第六步：设置定时器】
在Worker页面点击 "Triggers" → "Add Cron Trigger"
推荐设置：每5-15分钟执行一次
Cron表达式：* /5 * * * * （每5分钟）或 * /10 * * * * （每10分钟）

【第七步：测试运行】
直接访问你的Worker URL测试：
https://your-worker.your-subdomain.workers.dev/
查看Worker日志和Telegram通知确认工作正常

===========================================
⚠️ 重要提醒
===========================================

1. GitHub Token权限：必须勾选 "workflow" 权限
2. 执行频率：不要设置太频繁，建议5-15分钟
3. 免费额度：Cloudflare Workers每月有免费额度
4. 日志查看：在Cloudflare Dashboard查看Worker日志
5. 冷却时间：合理设置冷却时间，避免频繁触发
6. 并发限制：默认5个并发，太多任务请分批处理

===========================================
🔧 任务配置示例
===========================================

【条件触发任务】（监控网站状态）
{
  name: "我的网站监控",
  check_url: "https://www.example.com/page",
  trigger_status_codes: [404, 500],
  owner: "your-github-username",
  repo: "your-repo-name",
  workflow_id: "deploy.yml",
  ref: "main",
  enable_check: true,
  check_interval: 30 * 60 * 1000, // 30分钟冷却
  notify_on_skip: false
}

【定时触发任务】（固定时间执行）
{
  name: "每日备份",
  owner: "your-github-username",
  repo: "backup-repo",
  workflow_id: "backup.yml",
  ref: "main",
  enable_check: false,
  notify_on_skip: true
}

===========================================
🆘 常见问题
===========================================

Q: 工作流没有触发？
A: 检查GitHub Token权限，确保勾选了"workflow"

Q: Telegram不发通知？
A: 检查TELEGRAM_BOT_TOKEN和TELEGRAM_CHAT_ID是否正确设置

Q: 总是跳过执行？
A: 检查冷却时间设置，可能需要等待冷却期结束

Q: Worker报错？
A: 查看Cloudflare Dashboard的Worker日志获取详细错误信息
*/