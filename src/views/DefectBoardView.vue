<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const columns = ['待复核', '需整改', '整改中', '待复测', '停用', '已关闭'] as const
const riskOrder = { 紧急: 0, 高: 1, 中: 2, 低: 3 }
const grouped = computed(() =>
  Object.fromEntries(columns.map((status) => [
    status,
    store.records.filter((item) => item.status === status).sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])
  ]))
)

const fmt = (iso?: string) => (iso ? iso.replace('T', ' ').slice(5, 16) : '')

/**
 * 资源冲突处置走“冲突修订”链路：
 * 先保存的责任人/处置结论/证据编号受保护，调整意见保留在修订中可追溯采纳。
 */
function proposeConflictAdjustment() {
  const target = store.findRecord('INS-240821-02')
  if (!target) return
  const outcome = store.saveRecord(target.id, {
    baseRevision: target.revision - 1, // 故意携带旧基线，演示冲突保护
    operator: '调度台',
    windowId: 'WIN-DISPATCH',
    assignedTo: '检验二组',
    disposition: `${target.disposition}；调度建议转检验二组复测以避开开放高峰（资源冲突协调）`,
    risk: target.risk,
    dueDate: target.dueDate,
    stopped: target.stopped,
    evidenceIds: [],
    items: structuredClone(target.items)
  })
  if (outcome.conflict) message.warning(outcome.message)
  else message.success(outcome.message)
}
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div><h2>缺陷处置泳道</h2><p>按风险等级排列任务；卡片显示固定标准版本、责任人、证据数与下一次复测安排。</p></div>
      <NButton @click="store.resetDemo()">恢复演示数据</NButton>
    </div>
    <div class="kanban kanban-wide">
      <div v-for="column in columns" :key="column" class="kanban-column">
        <header><span>{{ column }}</span><b>{{ grouped[column].length }}</b></header>
        <article v-for="record in grouped[column]" :key="record.id" @click="router.push(`/records/${record.id}`)">
          <div>
            <NTag :type="record.risk === '紧急' ? 'error' : record.risk === '高' ? 'warning' : 'default'" size="small" :bordered="false">{{ record.risk }}风险</NTag>
            <small>R{{ record.revision }}</small>
          </div>
          <h3>{{ record.deviceName }}</h3>
          <p>{{ record.deviceCode }} · {{ record.area }}</p>
          <p class="card-standard">
            <NTag size="tiny" :type="record.standardId ? 'info' : 'default'" :bordered="false">
              {{ record.standardId || '无适用版本' }}
            </NTag>
            <span>证据 {{ record.evidenceIds.length }}</span>
          </p>
          <footer>
            <span>{{ record.assignedTo }}</span>
            <span :class="{ overdue: record.dueDate <= '2026-09-29' }">{{ record.dueDate }} 截止</span>
          </footer>
          <footer v-if="record.retests.length">
            <span :class="{ 'next-retest': !record.retests.at(-1)?.passed }">
              复测 {{ record.retests.at(-1)?.passed ? '已通过' : `${record.retests.length} 次未过` }}
            </span>
            <span v-if="record.retests.at(-1)?.nextRetestAt">下次 {{ fmt(record.retests.at(-1)?.nextRetestAt) }}</span>
          </footer>
        </article>
        <div v-if="!grouped[column].length" class="kanban-empty">暂无任务</div>
      </div>
    </div>
    <div class="conflict-table">
      <h3>资源冲突协调（走冲突修订，不覆盖现场记录）</h3>
      <p>早班维修一组同时承担高空飞翔整改与家庭过山车复测。调度调整以旧基线提交，系统生成冲突修订：现场窗口的责任人、处置结论、证据编号保留，调度意见留存待责任人采纳。</p>
      <button @click="proposeConflictAdjustment">提交调度协调（冲突修订）</button>
    </div>
  </section>
</template>
