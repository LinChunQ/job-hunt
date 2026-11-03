// 诊断报告只取固定字段，不复制配对码、网址参数或网页响应正文。
export function buildDiagnosticReport(config, checks, version) {
  const heartbeat = config.lastHeartbeatTabId === config.tabId ? config.lastHeartbeat : null;
  return {
    reportVersion: 1, extensionVersion: version, checkedAt: new Date().toISOString(),
    enabled: config.enabled === true, paired: /^[a-f0-9]{64}$/.test(config.key || ''),
    targetTab: checks.targetTab === true,
    pageChannel: checks.pageChannel === true,
    pageReadyState: ['loading','interactive','complete'].includes(checks.readyState) ? checks.readyState : null,
    heartbeatAgeSeconds: Number.isFinite(heartbeat) ? Math.max(0, Math.round((Date.now() - heartbeat) / 1000)) : null,
    localService: checks.localService === true, localError: checks.localError || null,
    bridgeConnected: checks.bridgeConnected === true, bridgeBlocked: checks.bridgeBlocked === true,
    taskStatus: ['pending','running','done','failed'].includes(checks.taskStatus) ? checks.taskStatus : null,
    lastErrorCode: config.lastErrorCode || null,
    siteRequestPerformedBySelfCheck: false,
    loginVerified: false,
  };
}
