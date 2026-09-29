import type { InspectionStandard } from '../types'

/**
 * 各设备型号系列的检验标准发布历史。
 * 新版本发布后，只对发布之后开始的任务生效；
 * 在途任务始终按开始时固定的版本判定。
 */
export const seedStandards: InspectionStandard[] = [
  {
    id: 'STD-AM-V1',
    family: 'AM',
    familyName: '飞行塔类',
    version: 1,
    publishedAt: '2026-08-01T09:00:00',
    publishedBy: '安全技术部',
    changeNote: '飞行塔类首版日常检验标准',
    isDefault: true,
    items: [
      { id: 'wear', name: '结构磨损', operator: 'le', threshold: 5.0, unit: 'mm', limit: '≤ 5.0 mm', requirement: '主支撑连接处磨损量' },
      { id: 'noise', name: '运行异响', operator: 'le', threshold: 75, unit: 'dB', limit: '≤ 75 dB', requirement: '满载连续运行噪声' },
      { id: 'brake', name: '制动装置', operator: 'le', threshold: 3.0, unit: 'm', limit: '制动距离 ≤ 3.0 m', requirement: '额定速度下制动距离' },
      { id: 'lock', name: '锁止机构', operator: 'le', threshold: 0, unit: '', limit: '无可见间隙', requirement: '安全压杠锁止无回弹间隙' },
      { id: 'safety', name: '安全装置', operator: 'le', threshold: 0, unit: '', limit: '动作可靠', requirement: '联锁与急停动作可靠' }
    ]
  },
  {
    id: 'STD-AM-V2',
    family: 'AM',
    familyName: '飞行塔类',
    version: 2,
    publishedAt: '2026-09-29T07:30:00',
    publishedBy: '安全技术部',
    changeNote: '结构磨损限值收紧至 4.0 mm，并新增锁止间隙复测要求',
    items: [
      { id: 'wear', name: '结构磨损', operator: 'le', threshold: 4.0, unit: 'mm', limit: '≤ 4.0 mm', requirement: '主支撑连接处磨损量（收紧）' },
      { id: 'noise', name: '运行异响', operator: 'le', threshold: 75, unit: 'dB', limit: '≤ 75 dB', requirement: '满载连续运行噪声' },
      { id: 'brake', name: '制动装置', operator: 'le', threshold: 3.0, unit: 'm', limit: '制动距离 ≤ 3.0 m', requirement: '额定速度下制动距离' },
      { id: 'lock', name: '锁止机构', operator: 'le', threshold: 0, unit: '', limit: '无可见间隙', requirement: '安全压杠锁止无回弹间隙，异常须复测' },
      { id: 'safety', name: '安全装置', operator: 'le', threshold: 0, unit: '', limit: '动作可靠', requirement: '联锁与急停动作可靠' }
    ]
  },
  {
    id: 'STD-RC-V1',
    family: 'RC',
    familyName: '过山车类',
    version: 1,
    publishedAt: '2026-08-01T09:00:00',
    publishedBy: '安全技术部',
    changeNote: '过山车类首版日常检验标准',
    isDefault: true,
    items: [
      { id: 'wear', name: '结构磨损', operator: 'le', threshold: 5.0, unit: 'mm', limit: '≤ 5.0 mm', requirement: '轨道与车体连接磨损' },
      { id: 'noise', name: '运行异响', operator: 'le', threshold: 78, unit: 'dB', limit: '≤ 78 dB', requirement: '满载连续运行噪声' },
      { id: 'brake', name: '制动装置', operator: 'le', threshold: 3.0, unit: 'm', limit: '制动距离 ≤ 3.0 m', requirement: '进站制动距离' },
      { id: 'lock', name: '锁止机构', operator: 'le', threshold: 0, unit: '', limit: '无可见间隙', requirement: '安全压杠二次锁止' },
      { id: 'safety', name: '安全装置', operator: 'le', threshold: 0, unit: '', limit: '动作可靠', requirement: '联锁与急停动作可靠' }
    ]
  },
  {
    id: 'STD-CR-V1',
    family: 'CR',
    familyName: '转马类',
    version: 1,
    publishedAt: '2026-08-05T09:00:00',
    publishedBy: '安全技术部',
    changeNote: '转马类首版日常检验标准',
    isDefault: true,
    items: [
      { id: 'wear', name: '结构磨损', operator: 'le', threshold: 6.0, unit: 'mm', limit: '≤ 6.0 mm', requirement: '中心主轴磨损量' },
      { id: 'noise', name: '运行异响', operator: 'le', threshold: 72, unit: 'dB', limit: '≤ 72 dB', requirement: '连续运行噪声' },
      { id: 'brake', name: '制动装置', operator: 'le', threshold: 0, unit: '', limit: '制动可靠', requirement: '停机制动平稳可靠' },
      { id: 'lock', name: '锁止机构', operator: 'le', threshold: 0, unit: '', limit: '闭合可靠', requirement: '乘骑单元锁扣闭合可靠' },
      { id: 'safety', name: '安全装置', operator: 'le', threshold: 0, unit: '', limit: '动作可靠', requirement: '联锁动作可靠' }
    ]
  }
  // WF（摩天轮类）暂无已发布标准：旧记录回填时进入待复核
]

/** 设备编号前缀即型号系列，例如 AM-014 → AM */
export function familyOf(deviceCode: string): string {
  return deviceCode.trim().split(/[-/\s]/)[0].toUpperCase()
}

export function latestStandard(family: string, standards: InspectionStandard[] = seedStandards): InspectionStandard | undefined {
  return standards
    .filter((standard) => standard.family === family)
    .sort((a, b) => b.version - a.version)[0]
}

/** 旧记录回填：取该系列默认（首版）标准 */
export function defaultStandard(family: string, standards: InspectionStandard[] = seedStandards): InspectionStandard | undefined {
  return standards.find((standard) => standard.family === family && standard.isDefault)
}

/** 已开始的任务：取任务开始时刻之前最新发布的版本 */
export function standardAt(family: string, at: string, standards: InspectionStandard[] = seedStandards): InspectionStandard | undefined {
  return standards
    .filter((standard) => standard.family === family && standard.publishedAt <= at)
    .sort((a, b) => b.version - a.version)[0]
}
