import { seedStandards } from './standards'
import { backfillLegacyRecord, buildNewRecord, type LegacyRecord } from '../services/domain'
import type { AuditEntry, InspectionDraft, InspectionItem, InspectionRecord } from '../types'

export { seedStandards }

const legacyItem = (
  id: string,
  name: string,
  result: InspectionItem['result'],
  reading: string,
  limit: string,
  note = ''
): InspectionItem => ({ id, name, result, reading, limit, standardId: '', note })

/** 旧系统遗留记录：没有标准版本号、没有修订链，等待迁移回填 */
const legacyRecords: LegacyRecord[] = [
  {
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-28T08:20:00', status: '需整改', risk: '高', stopped: true, assignedTo: '维修一组',
    disposition: '主支撑连接处磨损超限，停用隔离后更换衬套；安全压杠锁止机构同步检修',
    evidenceIds: ['EV-20260928-1011', 'EV-20260928-1012', 'EV-20260928-1013', 'EV-20260928-1014'],
    dueDate: '2026-09-29',
    items: [
      legacyItem('wear', '结构磨损', '异常', '6.8 mm', '≤ 5.0 mm', '主支撑连接处磨损超限'),
      legacyItem('noise', '运行异响', '正常', '68 dB', '≤ 75 dB'),
      legacyItem('brake', '制动装置', '正常', '制动距离 2.3 m', '≤ 3.0 m'),
      legacyItem('lock', '锁止机构', '异常', '存在间隙', '无可见间隙', '安全压杠锁止存在回弹'),
      legacyItem('safety', '安全装置', '正常', '联锁有效', '动作可靠')
    ],
    createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T09:35:00'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '中', stopped: false, assignedTo: '电气班组',
    disposition: '进站制动偏软，更换制动片后安排复测',
    evidenceIds: ['EV-20260928-2041', 'EV-20260928-2042'],
    dueDate: '2026-09-30',
    items: [
      legacyItem('wear', '结构磨损', '正常', '3.2 mm', '≤ 5.0 mm'),
      legacyItem('noise', '运行异响', '正常', '71 dB', '≤ 78 dB'),
      legacyItem('brake', '制动装置', '异常', '制动距离 3.6 m', '≤ 3.0 m', '制动距离偏大'),
      legacyItem('lock', '锁止机构', '正常', '二次锁止可靠', '无可见间隙'),
      legacyItem('safety', '安全装置', '正常', '联锁有效', '动作可靠')
    ],
    createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: false, assignedTo: '检验二组',
    disposition: '乘骑单元锁扣润滑处理，已申请复测',
    evidenceIds: ['EV-20260927-3305', 'EV-20260927-3306', 'EV-20260927-3307'],
    dueDate: '2026-09-29',
    items: [
      legacyItem('wear', '结构磨损', '正常', '2.9 mm', '≤ 6.0 mm'),
      legacyItem('noise', '运行异响', '正常', '66 dB', '≤ 72 dB'),
      legacyItem('brake', '制动装置', '正常', '制动可靠', '制动可靠'),
      legacyItem('lock', '锁止机构', '正常', '闭合可靠', '闭合可靠'),
      legacyItem('safety', '安全装置', '正常', '联锁有效', '动作可靠')
    ],
    createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00'
  },
  {
    // WF 摩天轮系列没有已发布标准：迁移后进入待复核
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组',
    disposition: '例行检验无异常',
    evidenceIds: ['EV-20260927-4101', 'EV-20260927-4102'],
    dueDate: '2026-09-28',
    items: [
      legacyItem('wear', '结构磨损', '正常', '1.8 mm', '按厂商手册'),
      legacyItem('noise', '运行异响', '正常', '64 dB', '按厂商手册'),
      legacyItem('brake', '制动装置', '正常', '制动可靠', '按厂商手册'),
      legacyItem('lock', '锁止机构', '正常', '舱门锁止可靠', '按厂商手册'),
      legacyItem('safety', '安全装置', '正常', '联锁有效', '按厂商手册')
    ],
    createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00'
  }
]

/** V2 标准（2026-09-29 07:30 发布）之后开始的新任务：自动固定执行 V2 */
function buildPostPublishRecord(standards: typeof seedStandards): InspectionRecord {
  const draft: InspectionDraft = {
    deviceCode: 'AM-015',
    deviceName: '高空飞翔Ⅱ',
    area: 'A区北侧',
    shift: '早班',
    inspector: '周宁',
    risk: '中',
    assignedTo: '维修三组',
    dueDate: '2026-09-30'
  }
  const record = buildNewRecord(draft, standards, '2026-09-29T08:10:00', 'INS-240929-01')
  // 现场实测 4.4 mm：在 V1（≤5.0）下合格、在 V2（≤4.0）下异常 —— 用于验证新任务按新版判定
  record.items = record.items.map((item) => {
    if (item.id === 'wear') return { ...item, reading: '4.4 mm', result: '异常', note: 'V2 限值收紧后实测超限' }
    if (item.id === 'noise') return { ...item, reading: '70 dB' }
    if (item.id === 'brake') return { ...item, reading: '制动距离 2.6 m' }
    if (item.id === 'lock') return { ...item, reading: '闭合可靠' }
    if (item.id === 'safety') return { ...item, reading: '联锁有效' }
    return item
  })
  record.status = '需整改'
  record.revisions[record.revisions.length - 1].fields.status = '需整改'
  record.revisions[record.revisions.length - 1].fields.items = structuredClone(record.items)
  record.revisions[record.revisions.length - 1].note += '；现场录入发现结构磨损 4.4 mm，按 V2 判定异常'
  return record
}

/** 含一次失败复测的在途任务：设备继续停用，并留下下一次复测安排 */
function buildFailedRetestRecord(standards: typeof seedStandards): InspectionRecord {
  const record = backfillLegacyRecord({
    id: 'INS-240928-09', deviceCode: 'AM-022', deviceName: '高空飞翔（备用机）', area: 'A区南侧', shift: '晚班', inspector: '陈默',
    inspectedAt: '2026-09-28T19:05:00', status: '停用', risk: '紧急', stopped: true, assignedTo: '维修二组',
    disposition: '锁止回弹未消除，执行停用隔离并安排复测',
    evidenceIds: ['EV-20260928-5201', 'EV-20260928-5202'],
    dueDate: '2026-09-29',
    items: [
      legacyItem('wear', '结构磨损', '正常', '2.4 mm', '≤ 5.0 mm'),
      legacyItem('noise', '运行异响', '正常', '70 dB', '≤ 75 dB'),
      legacyItem('brake', '制动装置', '正常', '制动距离 2.8 m', '≤ 3.0 m'),
      legacyItem('lock', '锁止机构', '异常', '锁止回弹', '无可见间隙', '加压后仍有回弹'),
      legacyItem('safety', '安全装置', '正常', '联锁有效', '动作可靠')
    ],
    createdAt: '2026-09-28T19:05:00', updatedAt: '2026-09-28T20:30:00'
  }, standards)
  record.status = '待复测'
  record.risk = '紧急'
  record.revisions.push({
    id: 'REV-seed-rt1', revision: record.revision + 1, kind: '复测失败', operator: '陈默', at: '2026-09-28T21:20:00',
    baseRevision: record.revision, fields: { status: '停用', stopped: true }, standardId: record.standardId,
    note: '第 1 次复测未通过（依据 STD-AM-V1）：锁止仍有回弹；设备继续停用，已预约下一次复测 2026-09-29 14:00'
  })
  record.revision += 1
  record.status = '停用'
  record.stopped = true
  record.retests.push({
    id: 'RT-0928-01', round: 1, testedAt: '2026-09-28T21:20:00', tester: '陈默', passed: false,
    summary: '锁止机构加压后仍有回弹，未达到 STD-AM-V1 “无可见间隙”要求',
    nextRetestAt: '2026-09-29T14:00', reopened: false, standardId: record.standardId
  })
  record.updatedAt = '2026-09-28T21:20:00'
  return record
}

export function buildSeed(): { records: InspectionRecord[]; audit: AuditEntry[] } {
  const standards = structuredClone(seedStandards)
  const records = [
    buildPostPublishRecord(standards),
    ...legacyRecords.map((raw) => backfillLegacyRecord(raw, standards)),
    buildFailedRetestRecord(standards)
  ]
  const audit: AuditEntry[] = records.flatMap((record) =>
    record.revisions.map((revision, index) => ({
      id: `${record.id}-A${index + 1}`,
      recordId: record.id,
      action: revision.kind,
      operator: revision.operator,
      detail: revision.note,
      createdAt: revision.at
    }))
  ).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return { records, audit }
}
