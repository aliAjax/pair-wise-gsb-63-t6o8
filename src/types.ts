export type InspectionStatus = '待检验' | '待复核' | '需整改' | '整改中' | '待复测' | '已关闭' | '停用'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'

/** 检验项判定方式：定量（阈值比较）或定性（关键词判定） */
export interface StandardItemDef {
  id: string
  name: string
  /** le = 实测值不大于阈值，ge = 不小于阈值 */
  operator: 'le' | 'ge'
  threshold?: number
  unit?: string
  /** 展示给检验员的限值原文，如 “≤ 5.0 mm” */
  limit: string
  /** 定性要求描述，阈值缺省时按描述关键词判定 */
  requirement: string
}

/** 按设备型号系列发布的检验标准版本 */
export interface InspectionStandard {
  /** 例如 STD-AM-V2 */
  id: string
  /** 设备型号系列代号，例如 AM */
  family: string
  familyName: string
  version: number
  publishedAt: string
  publishedBy: string
  changeNote: string
  items: StandardItemDef[]
  /** 旧记录回填时的默认版本（每系列最早一版） */
  isDefault?: boolean
}

export interface InspectionItem {
  id: string
  name: string
  result: CheckResult
  reading: string
  /** 任务开始时从标准版本快照下来的限值，之后不随后续发布变化 */
  limit: string
  /** 本项判定依据：STD-xx-Vn */
  standardId: string
  note: string
}

export interface RetestRecord {
  id: string
  round: number
  testedAt: string
  tester: string
  passed: boolean
  summary: string
  /** 复测失败时预约的下一次复测时间 */
  nextRetestAt?: string
  /** 合格后是否已据此恢复开放 */
  reopened: boolean
  /** 复测执行所依据的标准版本 */
  standardId: string
}

export interface RevisionFields {
  status?: InspectionStatus
  assignedTo?: string
  disposition?: string
  risk?: RiskLevel
  dueDate?: string
  stopped?: boolean
  evidenceIds?: string[]
  items?: InspectionItem[]
}

/** 冲突修订中需要永久保留的“先保存窗口”字段 */
export interface ProtectedPrior {
  operator: string
  windowId?: string
  at: string
  revision: number
  assignedTo: string
  disposition: string
  evidenceIds: string[]
}

export type RevisionKind =
  | '创建'
  | '标准回填'
  | '待复核登记'
  | '标准指派'
  | '检验保存'
  | '缺陷处置'
  | '冲突修订'
  | '状态流转'
  | '停用隔离'
  | '复测失败'
  | '复测通过'
  | '恢复开放'

export interface RecordRevision {
  id: string
  /** 该条修订写入后记录的修订号（乐观锁版本） */
  revision: number
  kind: RevisionKind
  operator: string
  windowId?: string
  at: string
  /** 本次保存基于的修订号；与当前修订号不一致即为并发保存 */
  baseRevision: number
  fields: RevisionFields
  /** 冲突修订时，先保存窗口被保护下来的责任人、处置结论和证据编号 */
  priorProtected?: ProtectedPrior
  note: string
  /** 本次修订关联的标准版本 */
  standardId?: string
}

export interface InspectionRecord {
  id: string
  deviceCode: string
  deviceName: string
  /** 设备型号系列，由设备编号前缀解析 */
  family: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionStatus
  risk: RiskLevel
  stopped: boolean
  assignedTo: string
  /** 缺陷处置结论 */
  disposition: string
  /** 现场证据编号，如 EV-20260928-0007 */
  evidenceIds: string[]
  dueDate: string
  items: InspectionItem[]
  /** 任务开始时固定的判定标准版本，在途任务不串用新标准 */
  standardId: string
  standardVersion: number
  /** 乐观锁修订号，每次保存 +1，用于多窗口冲突检测 */
  revision: number
  revisions: RecordRevision[]
  retests: RetestRecord[]
  /** 进入待复核的原因（无适用标准版本等） */
  reviewReason?: string
  createdAt: string
  updatedAt: string
}

export interface AuditEntry {
  id: string
  recordId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface InspectionDraft {
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  risk: RiskLevel
  assignedTo: string
  dueDate: string
}

export interface SavePayload {
  baseRevision: number
  operator: string
  windowId?: string
  assignedTo: string
  disposition: string
  risk: RiskLevel
  dueDate: string
  stopped: boolean
  evidenceIds: string[]
  items: InspectionItem[]
}

export interface SaveOutcome {
  ok: boolean
  conflict: boolean
  message: string
  /** 冲突时后保存者被规则保护而未直接写入的字段，供页面提示采纳 */
  laterInputs?: {
    assignedTo: string
    disposition: string
  }
}
