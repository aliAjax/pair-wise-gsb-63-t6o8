<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDataTable, NDatePicker, NForm, NFormItem, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useQuery } from '@tanstack/vue-query'
import { useInspectionStore } from '../stores/inspection'
import { loadInspectionSnapshot } from '../services/api'
import { latestStandard } from '../data/standards'
import type { InspectionDraft, RiskLevel } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const showCreate = ref(false)
const draft = ref<InspectionDraft>({ deviceCode: '', deviceName: '', area: 'A区北侧', shift: '早班', inspector: '周宁', risk: '中', assignedTo: '维修一组', dueDate: '2026-09-30' })

const { isFetching } = useQuery({
  queryKey: ['inspection-snapshot'],
  queryFn: () => loadInspectionSnapshot(store.records),
  staleTime: 60_000
})

const statusOptions = ['全部', '待检验', '待复核', '需整改', '整改中', '待复测', '已关闭', '停用'].map((value) => ({ label: value, value }))
const areaOptions = ['全部', ...new Set(store.records.map((item) => item.area))].map((value) => ({ label: value, value }))
const riskOptions: Array<{ label: RiskLevel; value: RiskLevel }> = ['低', '中', '高', '紧急'].map((value) => ({ label: value as RiskLevel, value: value as RiskLevel }))

function standardLabel(row: any): string {
  if (!row.standardId) return '无适用版本'
  return row.standardId.replace('STD-', '')
}

const columns = [
  { title: '检验编号', key: 'id', width: 145 },
  { title: '设备', key: 'deviceName', width: 150, render: (row: any) => `${row.deviceName} / ${row.deviceCode}` },
  { title: '区域', key: 'area', width: 90 },
  {
    title: '状态', key: 'status', width: 90,
    render: (row: any) => h(NTag, { type: row.status === '待复核' ? 'default' : row.stopped ? 'error' : row.status === '已关闭' ? 'success' : 'warning', bordered: false }, { default: () => row.status })
  },
  { title: '风险', key: 'risk', width: 70 },
  { title: '责任人', key: 'assignedTo', width: 100 },
  { title: '截止', key: 'dueDate', width: 105 },
  {
    title: '判定标准（开始时固定）', key: 'standardId', width: 190,
    render: (row: any) => h(NTag, { size: 'small', type: row.standardId ? 'info' : 'default', bordered: false }, { default: () => standardLabel(row) })
  },
  { title: '修订', key: 'revision', width: 70, render: (row: any) => `R${row.revision}` },
  { title: '', key: 'actions', width: 80, render: (row: any) => h(NButton, { size: 'small', tertiary: true, onClick: () => router.push(`/records/${row.id}`) }, { default: () => '打开' }) }
]

const validDraft = computed(() => draft.value.deviceCode && draft.value.deviceName && draft.value.assignedTo && draft.value.dueDate)
const previewStandard = computed(() => latestStandard(draft.value.deviceCode.trim().split(/[-/\s]/)[0]?.toUpperCase() ?? '', store.standards))

function createRecord() {
  if (!validDraft.value) return
  const record = store.addRecord(draft.value)
  showCreate.value = false
  if (record.status === '待复核') {
    message.warning(`${record.id} 已创建：该设备型号暂无已发布标准，已进入待复核`)
  } else {
    message.success(`已创建 ${record.id}，固定执行 ${record.standardId}`)
  }
  router.push(`/records/${record.id}`)
}
</script>

<template>
  <section class="content">
    <div class="metric-strip">
      <article><span>检验任务</span><strong>{{ store.stats.total }}</strong><small>早晚班共用设备台账</small></article>
      <article><span>停用设备</span><strong>{{ store.stats.blocked }}</strong><small>复测通过后才可恢复开放</small></article>
      <article><span>待复核</span><strong>{{ store.stats.review }}</strong><small>无适用标准版本</small></article>
      <article><span>复测/停用中</span><strong>{{ store.stats.retestPending }}</strong><small>失败将续排下一次复测</small></article>
    </div>

    <div class="toolbar">
      <NInput v-model:value="store.keyword" clearable placeholder="搜索设备、编号、检验员、责任人或标准版本" />
      <NSelect v-model:value="store.status" :options="statusOptions" style="width: 130px" />
      <NSelect v-model:value="store.area" :options="areaOptions" style="width: 130px" />
      <NButton type="primary" @click="showCreate = true">新建检验任务</NButton>
      <span class="query-state">{{ isFetching ? '正在同步' : '本地数据已加载' }}</span>
    </div>

    <NDataTable :columns="columns" :data="store.filtered" :bordered="false" :row-key="(row: any) => row.id" size="small" />

    <NModal v-model:show="showCreate" preset="card" title="新建日常检验任务" style="width: 620px">
      <NForm label-placement="left" label-width="92">
        <div class="form-grid">
          <NFormItem label="设备编号" required><NInput v-model:value="draft.deviceCode" placeholder="例如 RC-009，前缀即型号" /></NFormItem>
          <NFormItem label="设备名称" required><NInput v-model:value="draft.deviceName" /></NFormItem>
          <NFormItem label="区域"><NSelect v-model:value="draft.area" :options="areaOptions.filter((item) => item.value !== '全部')" /></NFormItem>
          <NFormItem label="班次"><NSelect v-model:value="draft.shift" :options="['早班', '中班', '晚班'].map((value) => ({ label: value, value }))" /></NFormItem>
          <NFormItem label="检验员"><NInput v-model:value="draft.inspector" /></NFormItem>
          <NFormItem label="风险等级"><NSelect v-model:value="draft.risk" :options="riskOptions" /></NFormItem>
          <NFormItem label="整改责任"><NInput v-model:value="draft.assignedTo" /></NFormItem>
          <NFormItem label="截止日期"><NDatePicker v-model:formatted-value="draft.dueDate" value-format="yyyy-MM-dd" type="date" /></NFormItem>
        </div>
        <p class="standard-preview">
          任务开始时将固定执行：
          <NTag v-if="previewStandard" size="small" type="info" :bordered="false">{{ previewStandard.id }}（{{ previewStandard.publishedAt.slice(0, 10) }} 发布）</NTag>
          <NTag v-else size="small" :bordered="false">该型号暂无已发布标准，任务将进入待复核</NTag>
        </p>
      </NForm>
      <template #footer>
        <div class="modal-actions">
          <span v-if="!validDraft" class="validation">设备编号、名称、责任人和截止日期必填</span>
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :disabled="!validDraft" @click="createRecord">创建并进入检验</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
