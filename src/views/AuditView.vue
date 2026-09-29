<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NInput, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const router = useRouter()
const keyword = ref('')

const entries = computed(() =>
  store.audit
    .filter((item) => !keyword.value || `${item.recordId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
)

const kindType = (action: string) => {
  if (action.includes('冲突')) return 'warning'
  if (action.includes('失败') || action === '停用隔离') return 'error'
  if (action.includes('通过') || action.includes('开放') || action.includes('发布')) return 'success'
  if (action.includes('回填') || action.includes('复核') || action.includes('指派')) return 'info'
  return 'default'
}
</script>

<template>
  <section class="content audit-layout">
    <div class="audit-head">
      <div><h2>操作审计与判定依据追溯</h2><p>标准发布、旧记录回填、检验保存、冲突修订、复测放行的完整时间线；点击编号可进入记录查看版本依据链。</p></div>
      <NInput v-model:value="keyword" clearable placeholder="按编号、操作人、动作、标准版本搜索" style="max-width: 340px" />
    </div>
    <div class="timeline">
      <article v-for="entry in entries" :key="entry.id">
        <div class="time">{{ entry.createdAt.replace('T', ' ').slice(0, 16) }}</div>
        <i />
        <div class="audit-card">
          <header>
            <strong>{{ entry.action }}</strong>
            <NTag size="small" :type="kindType(entry.action)" :bordered="false">{{ entry.recordId }}</NTag>
          </header>
          <p>{{ entry.detail }}</p>
          <small>
            操作人：{{ entry.operator }}
            <button v-if="entry.recordId !== '—'" class="link-btn" @click="router.push(`/records/${entry.recordId}`)">打开记录依据链 →</button>
          </small>
        </div>
      </article>
    </div>
  </section>
</template>
