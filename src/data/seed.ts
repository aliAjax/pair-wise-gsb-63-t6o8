import type {
  AuditEntry, ConflictRevision, EvidenceRef, InspectionItem, InspectionRecord,
  RetestRecord, StandardItem, StandardVersion
} from '../types'

const v1Items = (): StandardItem[] => [
  { id: 'wear', name: '结构磨损', limit: '≤ 5.0 mm', method: '游标卡尺测量主支撑连接处' },
  { id: 'noise', name: '运行异响', limit: '≤ 75 dB', method: '声级计距设备 1 m 实测' },
  { id: 'brake', name: '制动装置', limit: '制动距离 ≤ 3.0 m', method: '额定载荷下连续制动 3 次取最大值' },
  { id: 'lock', name: '锁止机构', limit: '无可见间隙', method: '手动检查安全压杠锁止，无回弹' },
  { id: 'safety', name: '安全装置', limit: '动作可靠', method: '空载联锁触发测试' }
]

const v2Items = (): StandardItem[] => [
  { id: 'wear', name: '结构磨损', limit: '≤ 4.0 mm', method: '游标卡尺测量主支撑连接处，早晚班各一次' },
  { id: 'noise', name: '运行异响', limit: '≤ 72 dB', method: '声级计距设备 1 m 实测，取三测点均值' },
  { id: 'brake', name: '制动装置', limit: '制动距离 ≤ 2.8 m', method: '额定载荷下连续制动 3 次取最大值，记录仪表读数' },
  { id: 'lock', name: '锁止机构', limit: '无可见间隙', method: '双人复核安全压杠锁止，确认无回弹并拍照' },
  { id: 'safety', name: '安全装置', limit: '动作可靠', method: '空载与带载荷联锁触发测试各一次' }
]

const models: Array<{ code: string; name: string }> = [
  { code: 'AM', name: '飞行塔类' },
  { code: 'RC', name: '过山车类' },
  { code: 'CR', name: '转马类' },
  { code: 'WF', name: '观览车类' }
]

const buildVersions = (items: StandardItem[], version: number, publishedAt: string, publishedBy: string, changeNote: string): StandardVersion[] =>
  models.map((model) => ({
    id: `STD-${model.code}-V${version}`,
    deviceModel: model.code,
    modelName: model.name,
    version,
    label: `V${version}`,
    publishedAt,
    publishedBy,
    changeNote,
    items: items.map((item) => ({ ...item }))
  }))

/** V1：月初发布；V2：管理员 09-26 调整检验标准后发布（限值收紧），不影响已开始任务 */
export const seedStandards: StandardVersion[] = [
  ...buildVersions(v1Items(), 1, '2026-09-01T08:00:00', '管理员 高安', '九月份检验标准首次发布'),
  ...buildVersions(v2Items(), 2, '2026-09-26T17:30:00', '管理员 高安', '收紧磨损、异响与制动限值，锁止改双人复核')
]

const evidence = (recordId: string, list: Array<[string, string, string]>): EvidenceRef[] =>
  list.map(([id, name, uploadedAt]) => ({ id, name, uploadedAt, uploadedBy: '周宁' }))

const itemsFrom = (standard: StandardItem[], values: Record<string, { result: InspectionItem['result']; reading: string; note?: string }>): InspectionItem[] =>
  standard.map((item) => ({
    id: item.id,
    name: item.name,
    result: values[item.id]?.result ?? '正常',
    reading: values[item.id]?.reading ?? '',
    limit: item.limit,
    note: values[item.id]?.note ?? ''
  }))

const v2 = v2Items()
const v1 = v1Items()

export const seedRecords: InspectionRecord[] = [
  {
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', deviceModel: 'AM', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-28T08:20:00', status: '需整改', risk: '高', stopped: true, assignedTo: '维修二组', dueDate: '2026-09-30',
    items: itemsFrom(v2, {
      wear: { result: '异常', reading: '4.6 mm', note: '主支撑连接处磨损超 V2 限值' },
      noise: { result: '正常', reading: '68 dB' },
      brake: { result: '正常', reading: '制动距离 2.3 m' },
      lock: { result: '异常', reading: '存在间隙', note: '安全压杠锁止存在回弹' },
      safety: { result: '正常', reading: '联锁有效' }
    }),
    evidence: evidence('INS-240821-01', [
      ['EV-240828-001', '锁止间隙近景', '2026-09-28T08:31:00'],
      ['EV-240828-002', '设备铭牌', '2026-09-28T08:33:00'],
      ['EV-240828-005', '磨损测量读数（晚班复核）', '2026-09-28T19:02:00'],
      ['EV-240828-006', '压杠回弹视频截图（晚班）', '2026-09-28T19:10:00']
    ]),
    disposition: '更换锁止销并复查压杠回弹，磨损点补焊加强',
    standardVersion: 2, standardLabel: 'V2', standardFrozenAt: '2026-09-28T08:20:00', reviewNote: '',
    retests: [], nextRetestDate: null, revision: 7, version: 7, lastSavedBy: '晚班窗口 · 郑涛',
    createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T19:12:00'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', deviceModel: 'RC', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '中', stopped: false, assignedTo: '电气班组', dueDate: '2026-10-01',
    items: itemsFrom(v2, {
      wear: { result: '正常', reading: '2.1 mm' },
      noise: { result: '异常', reading: '74 dB', note: 'V2 限值 72 dB，电机侧异响' },
      brake: { result: '正常', reading: '制动距离 2.6 m' },
      lock: { result: '正常', reading: '闭合可靠' },
      safety: { result: '正常', reading: '联锁有效' }
    }),
    evidence: evidence('INS-240821-02', [['EV-240828-101', '电机侧噪声测量', '2026-09-28T09:40:00']]),
    disposition: '更换电机侧轴承垫片，整改后复测噪声',
    standardVersion: 2, standardLabel: 'V2', standardFrozenAt: '2026-09-28T09:05:00', reviewNote: '',
    retests: [], nextRetestDate: null, revision: 3, version: 3, lastSavedBy: '早班窗口 · 李琪',
    createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', deviceModel: 'CR', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: true, assignedTo: '检验二组', dueDate: '2026-09-30',
    items: itemsFrom(v2, {
      wear: { result: '正常', reading: '1.8 mm' },
      noise: { result: '正常', reading: '66 dB' },
      brake: { result: '异常', reading: '制动距离 2.9 m', note: '首轮复测仍超 V2 限值 2.8 m' },
      lock: { result: '正常', reading: '闭合可靠' },
      safety: { result: '正常', reading: '联锁有效' }
    }),
    evidence: evidence('INS-240821-03', [
      ['EV-240827-201', '制动仪表读数', '2026-09-27T16:00:00'],
      ['EV-240828-202', '首轮复测制动记录', '2026-09-28T10:20:00']
    ]),
    disposition: '调整制动间隙后安排复测',
    standardVersion: 2, standardLabel: 'V2', standardFrozenAt: '2026-09-27T15:40:00', reviewNote: '',
    retests: [
      {
        id: 'RTS-240828-01', recordId: 'INS-240821-03', round: 1, testedAt: '2026-09-28T10:25:00', tester: '复测组 冯爽', result: '未通过',
        readings: [
          { itemId: 'brake', itemName: '制动装置', reading: '制动距离 2.9 m', limit: '制动距离 ≤ 2.8 m', pass: false },
          { itemId: 'wear', itemName: '结构磨损', reading: '1.8 mm', limit: '≤ 4.0 mm', pass: true }
        ],
        note: '制动距离仍超限，继续停用，登记下一次复测',
        nextRetestDate: '2026-09-30'
      } satisfies RetestRecord
    ],
    nextRetestDate: '2026-09-30', revision: 4, version: 4, lastSavedBy: '复测组 · 冯爽',
    createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00'
  },
  {
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', deviceModel: 'WF', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', dueDate: '2026-09-28',
    items: itemsFrom(v2, {
      wear: { result: '正常', reading: '1.6 mm' },
      noise: { result: '正常', reading: '64 dB' },
      brake: { result: '正常', reading: '制动距离 2.2 m' },
      lock: { result: '正常', reading: '闭合可靠' },
      safety: { result: '正常', reading: '联锁有效' }
    }),
    evidence: evidence('INS-240821-04', [['EV-240827-301', '终检联锁记录', '2026-09-28T16:10:00']]),
    disposition: '无异常，例行保养后关闭',
    standardVersion: 2, standardLabel: 'V2', standardFrozenAt: '2026-09-27T07:55:00', reviewNote: '',
    retests: [], nextRetestDate: null, revision: 5, version: 5, lastSavedBy: '维修二组',
    createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00'
  },
  {
    // V2 发布前（09-25）已开始的任务：标准冻结在 V1，磨损 4.6 mm 在 V1 合格、在 V2 不合格，不串用新标准
    id: 'INS-240820-05', deviceCode: 'AM-009', deviceName: '高空飞翔（二期）', deviceModel: 'AM', area: 'A区南侧', shift: '晚班', inspector: '郑涛',
    inspectedAt: '2026-09-25T20:10:00', status: '整改中', risk: '中', stopped: false, assignedTo: '维修一组', dueDate: '2026-09-30',
    items: itemsFrom(v1, {
      wear: { result: '正常', reading: '4.6 mm', note: '按开始时 V1 限值 ≤5.0 mm 判定合格' },
      noise: { result: '正常', reading: '73 dB' },
      brake: { result: '正常', reading: '制动距离 2.7 m' },
      lock: { result: '异常', reading: '锁止偏紧', note: '压杠闭合后开启费力' },
      safety: { result: '正常', reading: '联锁有效' }
    }),
    evidence: evidence('INS-240820-05', [['EV-240825-401', '锁止机构近景', '2026-09-25T20:40:00']]),
    disposition: '润滑锁止连杆，跟踪观察',
    standardVersion: 1, standardLabel: 'V1', standardFrozenAt: '2026-09-25T20:10:00', reviewNote: '',
    retests: [], nextRetestDate: null, revision: 2, version: 2, lastSavedBy: '晚班窗口 · 郑涛',
    createdAt: '2026-09-25T20:10:00', updatedAt: '2026-09-26T09:15:00'
  },
  {
    // 旧记录：设备型号 SP 无适用标准版本，迁移后进入待复核
    id: 'INS-240819-06', deviceCode: 'SP-002', deviceName: '高空弹跳塔', deviceModel: 'SP', area: '极限区', shift: '早班', inspector: '陈默',
    inspectedAt: '2026-09-26T08:40:00', status: '待复核', risk: '高', stopped: true, assignedTo: '安全技术部', dueDate: '2026-09-30',
    items: itemsFrom(v1, {
      wear: { result: '正常', reading: '2.4 mm' },
      noise: { result: '正常', reading: '70 dB' },
      brake: { result: '正常', reading: '制动距离 2.5 m' },
      lock: { result: '正常', reading: '闭合可靠' },
      safety: { result: '不适用', reading: '待确认', note: '该型号未配置联锁目录，需人工复核' }
    }),
    evidence: evidence('INS-240819-06', [['EV-240826-501', '弹射机构铭牌', '2026-09-26T09:00:00']]),
    disposition: '',
    standardVersion: 0, standardLabel: '无适用版本', standardFrozenAt: '', reviewNote: '未找到型号 SP 的已发布检验标准，保持停用并等待人工复核补版',
    retests: [], nextRetestDate: null, revision: 1, version: 1, lastSavedBy: '早班窗口 · 陈默',
    createdAt: '2026-09-26T08:40:00', updatedAt: '2026-09-26T09:05:00'
  }
]

export const seedConflictRevisions: ConflictRevision[] = [
  {
    id: 'CFL-240828-01',
    recordId: 'INS-240821-01',
    detectedAt: '2026-09-28T19:12:00',
    resolvedAt: '2026-09-28T19:12:00',
    winnerOperator: '晚班窗口 · 郑涛',
    loserOperator: '早班窗口 · 周宁',
    reason: '两窗口基于同一版本 R6 先后保存：早班 18:55 先保存责任人与处置结论，晚班 19:12 后保存，系统保留晚班输入并将早班记录留档为冲突修订',
    status: '已并入',
    loserSnapshot: {
      assignedTo: '维修一组',
      disposition: '主支撑补焊加强，焊后探伤',
      evidenceIds: ['EV-240828-001', 'EV-240828-002', 'EV-240828-003', 'EV-240828-004'],
      items: itemsFrom(v2, {
        wear: { result: '异常', reading: '4.6 mm', note: '早班：建议补焊' },
        lock: { result: '异常', reading: '存在间隙', note: '早班：压杠回弹' }
      })
    },
    winnerSnapshot: {
      assignedTo: '维修二组',
      disposition: '更换锁止销并复查压杠回弹，磨损点补焊加强',
      evidenceIds: ['EV-240828-005', 'EV-240828-006'],
      items: itemsFrom(v2, {
        wear: { result: '异常', reading: '4.6 mm', note: '晚班复核磨损' },
        lock: { result: '异常', reading: '存在间隙', note: '晚班：建议换件' }
      })
    }
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-STD-V1', recordId: 'STANDARD', action: '发布检验标准 V1', operator: '管理员 高安', detail: '面向 AM/RC/CR/WF 四类设备发布九月检验标准', standardLabel: 'V1', createdAt: '2026-09-01T08:00:00' },
  { id: 'AUD-STD-V2', recordId: 'STANDARD', action: '发布检验标准 V2', operator: '管理员 高安', detail: '收紧磨损（≤4.0mm）、异响（≤72dB）与制动（≤2.8m）限值；已开始任务继续按开始时版本判定', standardLabel: 'V2', createdAt: '2026-09-26T17:30:00' },
  ...seedRecords.flatMap((record) => [
    {
      id: `${record.id}-A1`, recordId: record.id, action: '创建检验记录', operator: record.inspector,
      detail: record.standardVersion > 0 ? `任务开始，冻结检验标准 ${record.standardLabel}` : '旧记录迁移：未找到适用标准，进入待复核',
      standardLabel: record.standardVersion > 0 ? record.standardLabel : null,
      createdAt: record.createdAt
    },
    ...(record.standardVersion === 1
      ? [{
          id: `${record.id}-A2`, recordId: record.id, action: '标准版本说明', operator: '系统',
          detail: 'V2 已发布，但本任务开始于 V2 生效前，仍按 V1 限值判定，不串用新标准',
          standardLabel: 'V1' as string | null,
          createdAt: '2026-09-26T17:30:00'
        }]
      : []),
    {
      id: `${record.id}-A3`, recordId: record.id, action: '现场检验保存', operator: record.inspector,
      detail: `记录更新至 R${record.revision}，依据 ${record.standardVersion > 0 ? record.standardLabel : '待复核'} 判定`,
      standardLabel: record.standardVersion > 0 ? record.standardLabel : null,
      createdAt: record.updatedAt
    }
  ]),
  {
    id: 'AUD-CFL-01', recordId: 'INS-240821-01', action: '生成冲突修订', operator: '系统',
    detail: '晚班窗口后保存，保留其输入；早班先保存的责任人「维修一组」、处置结论「主支撑补焊加强，焊后探伤」与证据 EV-240828-001~004 已留档（CFL-240828-01）',
    standardLabel: 'V2', createdAt: '2026-09-28T19:12:00'
  },
  {
    id: 'AUD-RTS-01', recordId: 'INS-240821-03', action: '复测未通过', operator: '复测组 冯爽',
    detail: '第 1 轮复测制动距离 2.9 m 超 V2 限值 2.8 m：继续停用，已登记 2026-09-30 下一次复测',
    standardLabel: 'V2', createdAt: '2026-09-28T10:25:00'
  }
].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
