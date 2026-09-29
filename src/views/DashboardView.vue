<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDataTable, NDatePicker, NForm, NFormItem, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useQuery } from '@tanstack/vue-query'
import { useInspectionStore } from '../stores/inspection'
import { loadInspectionSnapshot } from '../services/api'
import { resolveModel } from '../services/standards'
import type { InspectionDraft, RiskLevel } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const showCreate = ref(false)
const draft = ref<InspectionDraft>({
  deviceCode: '', deviceName: '', deviceModel: 'AM', area: 'A区北侧', shift: '早班',
  inspector: '周宁', risk: '中', assignedTo: '维修一组', dueDate: '2026-10-01'
})

const { isFetching } = useQuery({
  queryKey: ['inspection-snapshot'],
  queryFn: () => loadInspectionSnapshot(store.records),
  staleTime: 60_000
})

const statusOptions = ['全部', '待检验', '需整改', '整改中', '待复测', '停用', '已关闭', '待复核']
  .map((value) => ({ label: value, value }))
const areaOptions = ['全部', ...new Set(store.records.map((item) => item.area))].map((value) => ({ label: value, value }))
const riskOptions: Array<{ label: RiskLevel; value: RiskLevel }> = ['低', '中', '高', '紧急']
  .map((value) => ({ label: value as RiskLevel, value: value as RiskLevel }))

const createAreaOptions = ['A区北侧', 'A区南侧', 'B区', '亲子区', '湖景区', '极限区']
  .map((value) => ({ label: value, value }))

// 设备编号变化时自动带出型号前缀（如 AM-014 -> AM），型号决定执行哪一版检验标准
watch(() => draft.value.deviceCode, (code) => {
  const model = resolveModel(code)
  if (model) draft.value.deviceModel = model
})

const columns = [
  { title: '检验编号', key: 'id', width: 145 },
  { title: '设备', key: 'deviceName', width: 140, render: (row: any) => `${row.deviceName} / ${row.deviceCode}` },
  { title: '型号', key: 'deviceModel', width: 64 },
  { title: '区域', key: 'area', width: 90 },
  {
    title: '状态', key: 'status', width: 90,
    render: (row: any) => h(NTag, {
      type: row.status === '待复核' ? 'default' : row.stopped ? 'error' : row.status === '已关闭' ? 'success' : 'warning',
      bordered: false
    }, { default: () => row.status })
  },
  { title: '风险', key: 'risk', width: 64 },
  { title: '责任人', key: 'assignedTo', width: 100 },
  { title: '截止', key: 'dueDate', width: 104 },
  {
    title: '执行标准', key: 'standardLabel', width: 90,
    render: (row: any) => h(NTag, {
      type: row.standardVersion === 0 ? 'warning' : 'info',
      size: 'small',
      bordered: false
    }, { default: () => row.standardLabel })
  },
  { title: '', key: 'actions', width: 80, render: (row: any) => h(NButton, { size: 'small', tertiary: true, onClick: () => router.push(`/records/${row.id}`) }, { default: () => '打开' }) }
]

const validDraft = computed(() => draft.value.deviceCode && draft.value.deviceName && draft.value.assignedTo && draft.value.dueDate && draft.value.deviceModel)

function createRecord() {
  if (!validDraft.value) return
  const result = store.addRecord(draft.value)
  if (!result.ok) {
    message.error(result.message)
    return
  }
  showCreate.value = false
  result.review ? message.warning(result.message) : message.success(result.message)
  router.push(`/records/${result.record!.id}`)
}
</script>

<template>
  <section class="content">
    <div class="metric-strip metric-strip-5">
      <article><span>检验任务总数</span><strong>{{ store.stats.total }}</strong><small>含冻结在旧版的进行中任务</small></article>
      <article><span>停用设备</span><strong>{{ store.stats.blocked }}</strong><small>含复测失败继续停用</small></article>
      <article><span>待复核标准</span><strong>{{ store.stats.review }}</strong><small>无适用版本的旧记录</small></article>
      <article><span>待解决冲突</span><strong>{{ store.stats.conflicts }}</strong><small>并发窗口留档修订</small></article>
      <article><span>已闭环放行</span><strong>{{ store.stats.closed }}</strong><small>复测通过恢复开放</small></article>
    </div>

    <div class="toolbar">
      <NInput v-model:value="store.keyword" clearable placeholder="搜索设备、编号、检验员或责任人" />
      <NSelect v-model:value="store.status" :options="statusOptions" />
      <NSelect v-model:value="store.area" :options="areaOptions" />
      <NButton type="primary" @click="showCreate = true">新建检验任务</NButton>
      <span class="query-state">{{ isFetching ? '正在同步' : '本地数据已加载' }}</span>
    </div>

    <NDataTable :columns="columns" :data="store.filtered" :bordered="false" :row-key="(row: any) => row.id" size="small" />

    <NModal v-model:show="showCreate" preset="card" title="新建日常检验任务" style="width: 640px">
      <NForm label-placement="left" label-width="92">
        <div class="form-grid">
          <NFormItem label="设备编号" required><NInput v-model:value="draft.deviceCode" placeholder="例如 RC-009，自动识别型号" /></NFormItem>
          <NFormItem label="设备名称" required><NInput v-model:value="draft.deviceName" /></NFormItem>
          <NFormItem label="设备型号" required>
            <NSelect v-model:value="draft.deviceModel" :options="store.modelOptions" filterable tag placeholder="选择或输入型号，如 SP" />
          </NFormItem>
          <NFormItem label="区域"><NSelect v-model:value="draft.area" :options="createAreaOptions" /></NFormItem>
          <NFormItem label="班次"><NSelect v-model:value="draft.shift" :options="['早班', '中班', '晚班'].map((value) => ({ label: value, value }))" /></NFormItem>
          <NFormItem label="检验员"><NInput v-model:value="draft.inspector" /></NFormItem>
          <NFormItem label="风险等级"><NSelect v-model:value="draft.risk" :options="riskOptions" /></NFormItem>
          <NFormItem label="整改责任"><NInput v-model:value="draft.assignedTo" /></NFormItem>
          <NFormItem label="截止日期"><NDatePicker v-model:formatted-value="draft.dueDate" value-format="yyyy-MM-dd" type="date" /></NFormItem>
        </div>
        <p class="standard-hint">任务创建时按型号 {{ draft.deviceModel }} 当前发布版本冻结检验标准（限值），已开始任务不受之后发布的新标准影响；无适用版本的型号将登记为待复核。</p>
      </NForm>
      <template #footer>
        <div class="modal-actions">
          <span v-if="!validDraft" class="validation">设备编号、名称、型号、责任人和截止日期必填</span>
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :disabled="!validDraft" @click="createRecord">创建并进入检验</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
