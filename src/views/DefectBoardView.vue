<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const router = useRouter()
const columns = ['需整改', '整改中', '待复测', '停用', '待复核', '已关闭'] as const
const riskOrder: Record<string, number> = { 紧急: 0, 高: 1, 中: 2, 低: 3 }
const today = '2026-09-29'
const grouped = computed(() =>
  Object.fromEntries(columns.map((status) => [
    status,
    store.records.filter((item) => item.status === status).sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])
  ]))
)

const pendingConflicts = computed(() =>
  store.conflictRevisions
    .filter((item) => item.status === '待解决')
    .map((item) => ({ revision: item, record: store.records.find((record) => record.id === item.recordId) }))
    .filter((item) => item.record)
)
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div>
        <h2>缺陷处置泳道</h2>
        <p>按风险等级排列未闭环任务；复测失败的任务停留在「停用」并带下一次复测日期，卡片标注任务冻结的标准版本与冲突修订。</p>
      </div>
      <NButton @click="store.resetDemo()">恢复演示数据</NButton>
    </div>

    <div class="kanban kanban-6">
      <div v-for="column in columns" :key="column" class="kanban-column">
        <header><span>{{ column }}</span><b>{{ grouped[column].length }}</b></header>
        <article
          v-for="record in grouped[column]"
          :key="record.id"
          :class="{ review: record.status === '待复核' }"
          @click="router.push(`/records/${record.id}`)"
        >
          <div>
            <NTag :type="record.risk === '紧急' ? 'error' : record.risk === '高' ? 'warning' : 'default'" size="small" :bordered="false">
              {{ record.risk }}风险
            </NTag>
            <small>R{{ record.revision }} · {{ record.standardLabel }}</small>
          </div>
          <h3>{{ record.deviceName }}</h3>
          <p>{{ record.deviceCode }} · {{ record.deviceModel }} 型 · {{ record.area }}</p>
          <p v-if="record.disposition" class="disposition-line">{{ record.disposition }}</p>
          <div v-if="store.conflictsOf(record.id).length" class="conflict-flag">
            冲突修订 {{ store.conflictsOf(record.id).length }} 条
            <em v-if="store.conflictsOf(record.id).some((item) => item.status === '待解决')">· 待并入</em>
          </div>
          <div v-if="record.nextRetestDate" class="retest-flag">下次复测 {{ record.nextRetestDate }}</div>
          <footer>
            <span>{{ record.assignedTo }}</span>
            <span :class="{ overdue: record.dueDate <= today }">{{ record.dueDate }} 截止</span>
          </footer>
        </article>
        <div v-if="!grouped[column].length" class="kanban-empty">暂无任务</div>
      </div>
    </div>

    <div class="conflict-table">
      <h3>资源冲突与并发窗口提示</h3>
      <template v-if="pendingConflicts.length">
        <p v-for="item in pendingConflicts" :key="item.revision.id">
          {{ item.record!.deviceName }}（{{ item.record!.id }}）存在待并入的冲突修订 {{ item.revision.id }}：
          先保存窗口「{{ item.revision.loserOperator }}」的责任人、处置结论和证据编号已留档，请进入详情核对并回。
          <NButton size="small" style="margin-left: 8px" @click="router.push(`/records/${item.record!.id}`)">去核对</NButton>
        </p>
      </template>
      <p>早班维修一组同时承担高空飞翔紧急整改和家庭过山车复测，系统建议将后者调整至电气班组，避开开放高峰（仅调度责任人，不覆盖现场记录）。</p>
      <button @click="store.reassign('INS-240821-02', '电气班组', '调度员')">调整冲突工单</button>
    </div>
  </section>
</template>
