// 組織名冊（ADR-0047）的唯一來源已搬到 Cinderous SDK（SDK ADR 0132）：`@cinderous/client/protocol`，
// 讓自架站的 NIP-86 `cinder_applyroster`（ADR-0261）用同一份驗證。這裡照原名轉出，App 其他程式的 import 不必改。
// 要改名冊格式：先改 SDK、發版，再升這裡的相依（同 ADR-0370）。`ORG_ROSTER_KIND` 由 constants.ts 轉出。
export {
  ORG_RELAY_FILE_MAX_MB,
  ORG_TTL_MAX_DAYS,
  policyTtlSeconds,
  policyNotices,
  WELCOME_MAX_CHARS,
  inWorkHours,
  MIN_ROSTER,
  ROSTER_MAX_ADMINS,
  rosterSigners,
  signOrgRoster,
  verifyOrgRoster,
  applyRosterRotations,
  shouldAdoptRoster,
  rosterAllowlist,
  rosterRemap,
  diffRoster,
} from "@cinderous/client/protocol";
export type {
  OrgMember,
  OrgPolicy,
  PolicyNoticeId,
  PolicyNotice,
  OrgGroup,
  OrgWorkHours,
  OrgRosterDoc,
  RosterRemap,
  RosterTrust,
} from "@cinderous/client/protocol";
