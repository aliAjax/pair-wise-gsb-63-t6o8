import { createPinia, setActivePinia } from 'pinia'
import { useInspectionStore } from '../src/stores/inspection'
import type { AuditEntry, ConflictRevision, InspectionRecord, StandardVersion } from '../src/types'

interface PersistedState {
  standards: StandardVersion[]
  records: InspectionRecord[]
  conflictRevisions: ConflictRevision[]
  audit: AuditEntry[]
}

let passed = 0
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`断言失败: ${message}`)
  passed++
  console.log(`  ✓ ${message}`)
}

// ---- 内存 localStorage + 固定演示时间 ----
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
  clear() { this.map.clear() }
}
;(globalThis as any).localStorage = new MemoryStorage()

const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super('2026-09-29T10:00:00.000Z')
    else super(...(args as []))
  }
  static now() { return new RealDate('2026-09-29T10:00:00.000Z').getTime() }
}
;(globalThis as any).Date = FixedDate

function storeWithState(state: PersistedState | null) {
  ;(globalThis as any).localStorage.clear()
  if (state) localStorage.setItem('gsb63:inspection-platform:v2', JSON.stringify(state))
  setActivePinia(createPinia())
  return useInspectionStore()
}

// ============ 1. 种子初始化：版本冻结 / 待复核 ============
console.log('1. 初始化与标准版本')
let store = storeWithState(null)
const am009 = store.records.find((r) => r.id === 'INS-240820-05')!
assert(am009.standardLabel === 'V1', 'V2 发布前已开始的 AM-009 冻结在 V1')
assert(am009.items.find((i) => i.id === 'wear')!.limit === '≤ 5.0 mm', 'AM-009 磨损限值保留 V1 的 ≤5.0mm')
const am014 = store.records.find((r) => r.id === 'INS-240821-01')!
assert(am014.standardLabel === 'V2' && am014.items.find((i) => i.id === 'wear')!.limit === '≤ 4.0 mm', 'V2 发布后的任务使用 V2 限值 ≤4.0mm')
const sp002 = store.records.find((r) => r.id === 'INS-240819-06')!
assert(sp002.status === '待复核' && sp002.stopped === true, '无适用版本的旧记录进入待复核且保持停用')
const cr021 = store.records.find((r) => r.id === 'INS-240821-03')!
assert(cr021.retests.length === 1 && cr021.retests[0].result === '未通过' && cr021.nextRetestDate === '2026-09-30', '首轮复测失败记录与下一次复测日期存在')

// ============ 2. 发布新版：不影响已开始任务，只作用于新任务 ============
console.log('2. 发布 V3 标准')
const v3 = store.publishStandard({
  deviceModel: 'AM', modelName: '飞行塔类', changeNote: '演练收紧至 3.5mm', publishedBy: '管理员 高安',
  items: [
    { id: 'wear', name: '结构磨损', limit: '≤ 3.5 mm', method: 'm' },
    { id: 'noise', name: '运行异响', limit: '≤ 70 dB', method: 'm' }
  ]
})
assert(v3.version === 3, 'AM 发布后版本号递增为 V3')
assert(am009.standardLabel === 'V1' && am014.standardLabel === 'V2', '发布 V3 不改变已开始任务（V1/V2 保持）')
const created = store.addRecord({
  deviceCode: 'AM-020', deviceName: '高空飞翔（三期）', deviceModel: 'AM', area: 'A区北侧',
  shift: '晚班', inspector: '测试员', risk: '中', assignedTo: '维修一组', dueDate: '2026-10-02'
})
assert(created.ok && created.record!.standardLabel === 'V3', '新任务按最新发布的 V3 执行')
assert(created.record!.items.find((i) => i.id === 'wear')!.limit === '≤ 3.5 mm', '新任务限值快照取自 V3')

// 无适用标准型号的新任务
const unknown = store.addRecord({
  deviceCode: 'XX-001', deviceName: '未知设备', deviceModel: 'XX', area: 'B区',
  shift: '早班', inspector: '测试员', risk: '中', assignedTo: '维修一组', dueDate: '2026-10-02'
})
assert(unknown.review && unknown.record!.status === '待复核' && unknown.record!.stopped === true, '新型号无适用版本时新任务直接进入待复核')

// ============ 3. 并发窗口：后保存保留输入，先保存留档，证据编号不丢 ============
console.log('3. 两窗口先后保存的冲突修订')
store = storeWithState(null)
const target = store.records.find((r) => r.id === 'INS-240821-01')!
const baseRevision = target.revision // 7
// 早班窗口先保存（模拟另一窗口）
store.simulateConcurrentSave(target.id, '早班窗口 · 周宁')
assert(target.revision === baseRevision + 1, '先保存窗口使记录版本 +1')
const loserAssignee = target.assignedTo
const loserDisposition = target.disposition
// 先保存窗口上传了两份证据
const evA = store.uploadEvidence(target.id, '早班补充照片A', '早班窗口 · 周宁')
const evB = store.uploadEvidence(target.id, '早班补充照片B', '早班窗口 · 周宁')
// 晚班窗口基于旧版本保存，自己的输入 + 一份新证据
const evC = { id: 'EV-LATE-001', name: '晚班复核照片', uploadedAt: new Date().toISOString(), uploadedBy: '晚班窗口 · 郑涛' }
const result = store.saveRecord({
  id: target.id, baseRevision, operator: '晚班窗口 · 郑涛',
  assignedTo: '维修二组', dueDate: target.dueDate, risk: '高', stopped: true,
  items: target.items.map((i) => ({ ...i })), disposition: '晚班结论：更换锁止销',
  evidence: [evC]
})
assert(result.conflict === true, '后保存窗口检测到版本落后并生成冲突修订')
assert(target.assignedTo === '维修二组' && target.disposition === '晚班结论：更换锁止销', '后保存窗口保留自己的责任人和处置结论')
const conflict = store.conflictsOf(target.id).find((c) => c.id === result.conflictId)!
assert(conflict.loserSnapshot.assignedTo === loserAssignee, '先保存责任人留档不丢')
assert(conflict.loserSnapshot.disposition === loserDisposition, '先保存处置结论留档不丢')
assert(conflict.loserSnapshot.evidenceIds.includes(evA.id) && conflict.loserSnapshot.evidenceIds.includes(evB.id), '先保存证据编号留档不丢')
for (const id of [evA.id, evB.id, evC.id, 'EV-240828-001', 'EV-240828-002', 'EV-240828-005', 'EV-240828-006']) {
  assert(target.evidence.some((e) => e.id === id), `记录证据合并保留 ${id}`)
}
// 并回先保存责任人
store.mergeConflictField(target.id, conflict.id, 'assignedTo', '晚班窗口 · 郑涛')
assert(target.assignedTo === loserAssignee && conflict.status === '已并入', '冲突修订中的先保存责任人可并回并标记已并入')
// 待复核记录不能直接保存
const saveReview = store.saveRecord({
  id: 'INS-240819-06', baseRevision: 1, operator: 'x', assignedTo: 'a', dueDate: '2026-10-01',
  risk: '高', stopped: true, items: [], disposition: '', evidence: []
})
assert(!saveReview.ok, '待复核记录未补绑版本前禁止保存检验')

// ============ 4. 复测：失败继续停用并留下下一次复测，成功恢复开放 ============
console.log('4. 复测闭环')
store = storeWithState(null)
const failed = store.submitRetest({
  recordId: 'INS-240821-03', tester: '复测组 冯爽',
  readings: [{ itemId: 'brake', itemName: '制动装置', reading: '制动距离 2.9 m', limit: '制动距离 ≤ 2.8 m', pass: false }],
  note: '仍超限', nextRetestDate: '2026-10-02'
})
const crAfterFail = store.records.find((r) => r.id === 'INS-240821-03')!
assert(failed.ok && crAfterFail.status === '停用' && crAfterFail.stopped === true, '复测失败继续停用')
assert(crAfterFail.retests.length === 2 && crAfterFail.nextRetestDate === '2026-10-02', '复测失败后留下下一次复测安排')
const passed2 = store.submitRetest({
  recordId: 'INS-240821-03', tester: '复测组 冯爽',
  readings: [{ itemId: 'brake', itemName: '制动装置', reading: '制动距离 2.5 m', limit: '制动距离 ≤ 2.8 m', pass: true }],
  note: '更换制动片后合格', nextRetestDate: '2026-10-04'
})
const crAfterPass = store.records.find((r) => r.id === 'INS-240821-03')!
assert(passed2.ok && crAfterPass.status === '已关闭' && crAfterPass.stopped === false, '复测成功后恢复开放并关闭任务')
assert(crAfterPass.nextRetestDate === null, '复测通过后清除下一次复测安排')

// ============ 5. 待复核补绑版本 ============
console.log('5. 待复核旧记录补绑版本')
store = storeWithState(null)
const stdSP = store.publishStandard({
  deviceModel: 'SP', modelName: '弹跳塔类', changeNote: '补充弹跳塔类标准', publishedBy: '管理员 高安',
  items: [{ id: 'eject', name: '弹射机构', limit: '动作可靠', method: '空载循环' }]
})
const adopt = store.adoptStandard('INS-240819-06', stdSP.id, '安全技术部 陈默')
const spAfter = store.records.find((r) => r.id === 'INS-240819-06')!
assert(adopt.ok && spAfter.standardLabel === 'V1' && spAfter.status === '待检验', '补绑版本后待复核记录可重新录入')
assert(spAfter.items[0].id === 'eject' && spAfter.items[0].limit === '动作可靠', '补绑后检验项按所选版本重建')
assert(spAfter.stopped === true, '补绑后仍停用，须检验/复测通过才开放')

// ============ 6. 旧格式数据迁移 ============
console.log('6. 旧记录按设备型号补默认版本 / 无版本进待复核')
;(globalThis as any).localStorage.clear()
const legacyRecord = {
  id: 'INS-OLD-1', deviceCode: 'RC-100', deviceName: '旧过山车', area: 'B区', shift: '早班',
  inspector: '老周', inspectedAt: '2026-09-27T08:00:00', status: '整改中', risk: '中', stopped: false,
  assignedTo: '维修组', dueDate: '2026-10-01', evidenceCount: 1, version: 2,
  items: [{ id: 'wear', name: '结构磨损', result: '正常', reading: '2.0 mm', limit: '旧限值', note: '' }],
  createdAt: '2026-09-27T08:00:00', updatedAt: '2026-09-27T09:00:00'
}
const unknownLegacy = {
  ...legacyRecord, id: 'INS-OLD-2', deviceCode: 'ZZ-100', deviceName: '未知老设备',
  createdAt: '2026-09-27T08:00:00', updatedAt: '2026-09-27T09:00:00'
}
localStorage.setItem('gsb63:inspection-platform', JSON.stringify({ records: [legacyRecord, unknownLegacy], audit: [] }))
setActivePinia(createPinia())
store = useInspectionStore()
const migrated = store.records.find((r) => r.id === 'INS-OLD-1')!
assert(migrated.deviceModel === 'RC' && migrated.standardLabel === 'V2', '旧记录按型号 RC 补上创建时刻最新版本 V2')
assert(migrated.items[0].limit === '≤ 4.0 mm', '旧记录检验项限值按补绑版本刷新')
assert(Array.isArray(migrated.evidence) && migrated.revision === 2, '旧记录补齐证据数组与乐观锁版本')
const migratedUnknown = store.records.find((r) => r.id === 'INS-OLD-2')!
assert(migratedUnknown.status === '待复核' && migratedUnknown.standardVersion === 0, '无适用版本的旧记录进入待复核')

console.log(`\n全部通过：${passed} 项断言`)
