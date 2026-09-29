<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSelect, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const route = useRoute()
const router = useRouter()
const keyword = ref('')
const scope = ref<'all' | 'standard' | 'conflict' | 'retest'>('all')

watch(() => route.query.record, (recordId) => {
  if (typeof recordId === 'string' && recordId) keyword.value = recordId
}, { immediate: true })

const scopeOptions = [
  { label: '全部时间线', value: 'all' },
  { label: '标准发布', value: 'standard' },
  { label: '冲突修订', value: 'conflict' },
  { label: '复测放行', value: 'retest' }
]

const entries = computed(() => store.audit.filter((item) => {
  const hitKeyword = !keyword.value
    || `${item.recordId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)
  if (!hitKeyword) return false
  if (scope.value === 'standard') return item.recordId === 'STANDARD' || item.action.includes('标准')
  if (scope.value === 'conflict') return item.action.includes('冲突')
  if (scope.value === 'retest') return item.action.includes('复测') || item.action.includes('放行')
  return true
}))

function tagType(action: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
  if (action.includes('发布')) return 'info'
  if (action.includes('冲突')) return 'warning'
  if (action.includes('未通过') || action.includes('停用')) return 'error'
  if (action.includes('通过') || action.includes('放行') || action.includes('关闭')) return 'success'
  return 'default'
}
</script>

<template>
  <section class="content audit-layout">
    <div class="audit-head">
      <div>
        <h2>操作审计与判定依据追溯</h2>
        <p>沿「标准版本 → 冲突修订 → 复测记录」可以重新找到每一次判定的依据；每条记录标注冻结的标准版本。</p>
      </div>
      <div class="audit-filters">
        <NSelect v-model:value="scope" :options="scopeOptions" style="width: 140px" />
        <NInput v-model:value="keyword" clearable placeholder="按编号、操作人、动作搜索" style="width: 290px" />
        <NButton v-if="route.query.record" size="small" @click="router.push('/audit'); keyword = ''">清除记录筛选</NButton>
      </div>
    </div>
    <div class="timeline">
      <article v-for="entry in entries" :key="entry.id">
        <div class="time">{{ entry.createdAt.replace('T', ' ').slice(0, 16) }}</div>
        <i />
        <div class="audit-card">
          <header>
            <div class="audit-title">
              <strong>{{ entry.action }}</strong>
              <NTag size="small" :type="tagType(entry.action)" :bordered="false">{{ entry.recordId }}</NTag>
              <NTag v-if="entry.standardLabel" size="small" type="info" :bordered="false">依据 {{ entry.standardLabel }}</NTag>
            </div>
          </header>
          <p>{{ entry.detail }}</p>
          <small>操作人：{{ entry.operator }}</small>
        </div>
      </article>
      <div v-if="!entries.length" class="kanban-empty">没有匹配的审计记录</div>
    </div>
  </section>
</template>
