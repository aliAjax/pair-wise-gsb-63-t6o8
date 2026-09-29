/* 领域规则验证（经 esbuild 转译后运行）：
 * 1. 新任务按发布版本执行；在途任务不串用新标准
 * 2. 两窗口先后保存：后保存生成冲突修订，先保存的责任人/处置结论/证据编号不丢
 * 3. 旧记录按型号补默认版本；无适用版本进入待复核
 * 4. 复测失败继续停用并留下下一次复测；成功后才能恢复开放
 * 5. 重新打开可沿版本/修订/复测找到判定依据
 */
import { seedStandards, latestStandard } from '../src/data/standards'
import {
  applyRetest,
  backfillLegacyRecord,
  buildNewRecord,
  publishStandard,
  reopen,
  saveInspection
} from '../src/services/domain'
import type { InspectionDraft, LegacyRecord } from '../src/types'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} ${extra}`) }
}

const standards = structuredClone(seedStandards)

// ---- 场景 1：标准发布与版本固定 ----
console.log('\n[1] 标准发布与版本固定')
const draft: InspectionDraft = {
  deviceCode: 'AM-100', deviceName: '早班设备', area: 'A区', shift: '早班',
  inspector: '周宁', risk: '中', assignedTo: '维修一组', dueDate: '2026-10-01'
}
// 任务在 V2 发布前开始 → 固定 V1
const beforePublish = buildNewRecord(draft, standards, '2026-09-28T08:00:00', 'INS-T1')
check('发布前开始的任务固定 V1', beforePublish.standardId === 'STD-AM-V1', beforePublish.standardId)

// 发布 V3：收紧磨损限值到 3.0
const v3 = publishStandard(standards, 'AM', '飞行塔类', '安全部', 'V3 再次收紧磨损限值', [
  { id: 'wear', threshold: 3.0, limit: '≤ 3.0 mm' }
])
check('发布生成 STD-AM-V3', v3.id === 'STD-AM-V3', v3.id)

// 在途任务：实测 4.4 → 按 V1（≤5.0）应判正常
beforePublish.items[0].reading = '4.4 mm'
saveInspection(beforePublish, {
  baseRevision: beforePublish.revision, operator: '周宁', assignedTo: '维修一组',
  disposition: '', risk: '中', dueDate: '2026-10-01', stopped: false, evidenceIds: [], items: beforePublish.items
}, standards)
check('在途任务按开始时 V1 判定，4.4mm 正常', beforePublish.items[0].result === '正常', beforePublish.items[0].result)
check('在途任务限值仍为 V1 快照 ≤5.0mm', beforePublish.items[0].limit === '≤ 5.0 mm', beforePublish.items[0].limit)

// V3 发布后新任务：实测 4.4 → 按 V3（≤3.0）应判异常
const afterPublish = buildNewRecord({ ...draft, deviceCode: 'AM-101', deviceName: '晚班设备' }, standards, new Date().toISOString(), 'INS-T2')
check('新任务自动固定最新 V3', afterPublish.standardId === 'STD-AM-V3', afterPublish.standardId)
afterPublish.items[0].reading = '4.4 mm'
saveInspection(afterPublish, {
  baseRevision: afterPublish.revision, operator: '林岚', assignedTo: '维修一组',
  disposition: '', risk: '中', dueDate: '2026-10-01', stopped: false, evidenceIds: [], items: afterPublish.items
}, standards)
check('新任务按 V3 判定 4.4mm 异常', afterPublish.items[0].result === '异常', afterPublish.items[0].result)

// ---- 场景 2：两窗口并发保存 ----
console.log('\n[2] 两窗口先后保存与冲突修订')
const rec = buildNewRecord(draft, standards, '2026-09-28T08:00:00', 'INS-T3')
const openedAt = rec.revision
// 窗口 A 先保存（责任人 A、处置 A、证据 EV-A）
saveInspection(rec, {
  baseRevision: openedAt, operator: '早班·周宁', windowId: 'WIN-A', assignedTo: '维修一组',
  disposition: '早班结论：更换衬套', risk: '高', dueDate: '2026-09-30', stopped: true,
  evidenceIds: ['EV-A-001'], items: rec.items
}, standards)
check('先保存窗口写入成功', rec.assignedTo === '维修一组' && rec.disposition === '早班结论：更换衬套' && rec.evidenceIds.includes('EV-A-001'))
const afterA = rec.revision

// 窗口 B 仍以打开时基线保存
const outcomeB = saveInspection(rec, {
  baseRevision: openedAt, operator: '晚班·林岚', windowId: 'WIN-B', assignedTo: '维修二组',
  disposition: '晚班结论：加固支架', risk: '中', dueDate: '2026-10-02', stopped: false,
  evidenceIds: ['EV-B-009'], items: structuredClone(rec.items).map((it, i) => i === 1 ? { ...it, reading: '80 dB' } : it)
}, standards)
check('后保存返回冲突标记', outcomeB.conflict === true)
check('冲突后生成“冲突修订”', rec.revisions.at(-1)?.kind === '冲突修订', rec.revisions.at(-1)?.kind ?? '')
check('先保存责任人未被覆盖', rec.assignedTo === '维修一组', rec.assignedTo)
check('先保存处置结论未被覆盖', rec.disposition === '早班结论：更换衬套', rec.disposition)
check('先保存证据编号未丢失', rec.evidenceIds.includes('EV-A-001'), JSON.stringify(rec.evidenceIds))
check('后保存证据编号已合并保留', rec.evidenceIds.includes('EV-B-009'), JSON.stringify(rec.evidenceIds))
const conflictRev = rec.revisions.at(-1)!
check('冲突修订留存后保存责任人意见', conflictRev.fields.assignedTo === '维修二组')
check('冲突修订留存后保存处置结论', conflictRev.fields.disposition === '晚班结论：加固支架')
check('冲突修订保留先保存受保护快照', conflictRev.priorProtected?.assignedTo === '维修一组' && conflictRev.priorProtected.disposition === '早班结论：更换衬套' && conflictRev.priorProtected.evidenceIds.includes('EV-A-001'))
check('修订号持续递增', rec.revision === afterA + 1, `${rec.revision} vs ${afterA + 1}`)

// 窗口 B 的录入（80dB 异常）仍按其输入重判并保留在记录中
check('后保存的检验录入已生效', rec.items[1].reading === '80 dB' && rec.items[1].result === '异常', `${rec.items[1].reading}/${rec.items[1].result}`)

// ---- 场景 3：旧记录回填 ----
console.log('\n[3] 旧记录按型号补默认版本 / 无版本进待复核')
const legacy: LegacyRecord = {
  id: 'INS-OLD-1', deviceCode: 'AM-300', deviceName: '旧飞行塔', area: 'A区', shift: '早班', inspector: '赵',
  inspectedAt: '2026-08-10T08:00:00', status: '需整改', risk: '高', stopped: true, assignedTo: '维修一组',
  disposition: '旧处置', evidenceIds: ['EV-OLD-1'], dueDate: '2026-08-12',
  items: [
    { id: 'wear', name: '结构磨损', result: '异常', reading: '6.8 mm', limit: '旧限值', standardId: '', note: '' },
    { id: 'noise', name: '运行异响', result: '正常', reading: '68 dB', limit: '旧限值', standardId: '', note: '' },
    { id: 'brake', name: '制动装置', result: '正常', reading: '制动距离 2.3 m', limit: '旧限值', standardId: '', note: '' },
    { id: 'lock', name: '锁止机构', result: '异常', reading: '存在间隙', limit: '旧限值', standardId: '', note: '' },
    { id: 'safety', name: '安全装置', result: '正常', reading: '联锁有效', limit: '旧限值', standardId: '', note: '' }
  ],
  createdAt: '2026-08-10T08:00:00', updatedAt: '2026-08-10T10:00:00'
}
const migrated = backfillLegacyRecord(legacy, seedStandards)
check('旧记录补挂默认 V1', migrated.standardId === 'STD-AM-V1', migrated.standardId)
check('各项限值快照为 V1 限值', migrated.items[0].limit === '≤ 5.0 mm', migrated.items[0].limit)
check('旧实测按 V1 重新判定（6.8mm 异常）', migrated.items[0].result === '异常')
check('回填动作写入修订链', migrated.revisions.some((r) => r.kind === '标准回填'))

const legacyNoStd: LegacyRecord = { ...structuredClone(legacy), id: 'INS-OLD-2', deviceCode: 'ZZ-001', deviceName: '未知设备', items: structuredClone(legacy.items) }
const migratedReview = backfillLegacyRecord(legacyNoStd, seedStandards)
check('无适用版本进入待复核', migratedReview.status === '待复核', migratedReview.status)
check('登记待复核原因', Boolean(migratedReview.reviewReason && migratedReview.reviewReason.includes('ZZ')))
check('待复核登记写入修订链', migratedReview.revisions.some((r) => r.kind === '待复核登记'))

// ---- 场景 4：复测失败停用续排 / 通过后开放 ----
console.log('\n[4] 复测失败继续停用并续排，成功后才能恢复开放')
const rtRec = backfillLegacyRecord(structuredClone(legacy), seedStandards)
rtRec.status = '待复测'
// 未到复测状态不能登记
check('非待复测/停用状态不能复测', applyRetest(buildNewRecord(draft, standards, '2026-09-28T08:00:00', 'INS-T4'), { tester: '周宁', passed: true, summary: '通过' }).ok === false)

const r1 = applyRetest(rtRec, { tester: '周宁', passed: false, summary: '仍有间隙' })
check('复测失败必须预约下一次复测', r1.ok === false, r1.message)
const r2 = applyRetest(rtRec, { tester: '周宁', passed: false, summary: '仍有间隙', nextRetestAt: '2026-09-30T10:00' })
check('带预约的失败复测可登记', r2.ok === true, r2.message)
check('失败后继续停用', rtRec.stopped === true && rtRec.status === '停用')
check('留下下一次复测安排', rtRec.retests[0].nextRetestAt === '2026-09-30T10:00')
check('失败时不能恢复开放', reopen(rtRec, '周宁').ok === false)

const r3 = applyRetest(rtRec, { tester: '周宁', passed: true, summary: '间隙消除，复测合格' })
check('复测通过可登记', r3.ok === true, r3.message)
check('通过后状态为已关闭（待开放确认）', rtRec.status === '已关闭' && rtRec.stopped === true)
const rp = reopen(rtRec, '值班经理')
check('通过后才能恢复开放', rp.ok === true, rp.message)
check('已恢复开放（stopped=false）', rtRec.stopped === false)
check('复测记录标记 reopened', rtRec.retests.at(-1)?.reopened === true)
check('最新复测记录保留固定标准版本', rtRec.retests.every((r) => r.standardId === 'STD-AM-V1'))

// ---- 场景 5：判定依据链完整可溯 ----
console.log('\n[5] 重新打开：沿版本 / 修订 / 复测找回依据')
check('记录保存标准版本号', rtRec.standardId === 'STD-AM-V1' && rtRec.standardVersion === 1)
check('修订链包含创建/回填/复测失败/复测通过/恢复开放', ['创建', '标准回填', '复测失败', '复测通过', '恢复开放'].every((k) => rtRec.revisions.some((r) => r.kind === k)))
check('回填之后的每条修订都带标准版本引用', rtRec.revisions.filter((r) => r.kind !== '创建').every((r) => r.standardId === 'STD-AM-V1'))
check('每次复测可独立回溯（2 条记录）', rtRec.retests.length === 2)
check('冲突记录可回溯到先保存窗口与基线', conflictRev.baseRevision === openedAt && conflictRev.priorProtected?.revision === afterA)

// 新标准库中仍能取到全部历史版本
check('历史版本仍在标准库可查', standards.filter((s) => s.family === 'AM').length === 3 && latestStandard('AM', standards)?.id === 'STD-AM-V3')

console.log(failures === 0 ? '\n全部验证通过 ✅' : `\n有 ${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
