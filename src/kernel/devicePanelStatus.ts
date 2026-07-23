export function getDevicePanelStatus(opts?: {
  onlineCount?: number;
  totalCount?: number;
  strengthScore?: number;
  hubConnected?: boolean;
  wifiSaved?: number;
  btLinked?: number;
}) {
  const onlineCount = opts?.onlineCount ?? 0;
  const totalCount = opts?.totalCount ?? 0;
  const strengthScore = opts?.strengthScore ?? 0;
  const hubConnected = opts?.hubConnected ?? false;
  const wifiSaved = opts?.wifiSaved ?? 0;
  const btLinked = opts?.btLinked ?? 0;

  const pieces = [
    `${onlineCount} online`,
    `${totalCount} total`,
    `${strengthScore}/100 strength`,
    hubConnected ? "mesh hub online" : "mesh hub offline",
    `${wifiSaved} saved wifi`,
    `${btLinked} bluetooth`,
  ];

  return {
    summary: pieces.join(" · "),
    hubConnected,
    strengthScore,
    wifiSaved,
    btLinked,
  };
}
