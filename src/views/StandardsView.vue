<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import type { InspectionStandard } from '../types'

const store = useInspectionStore()
const message = useMessage()

const groups = computed(() => {
  const map = new Map<string, { family: string; familyName: string; standards: InspectionStandard[]; records: number }>()
  for (const standard of store.standards) {
    if (!map.has(standard.family)) {
      map.set(standard.family, { family: standard.family, familyName: standard.familyName, standards: [], records: 0 })
    }
    map.get(standard.family)!.standards.push(standard)
  }
  for (const record of store.records) {
    if (map.has(record.family)) map.get(record.family)!.records += 1
  }
  return [...map.values()].map((group) => ({
    ...group,
    standards: group.standards.sort((a, b) => b.version - a.version)
  }))
})

const showPublish = ref(false)
const publishForm = ref({ family: 'AM', familyName: '飞行塔类', changeNote: '', wearThreshold: '4.0', wearLimit: '≤ 4.0 mm', operator: '安全技术部' })
const familyOptions = computed(() => {
  const existing = new Set(store.standards.map((item) => item.family))
  const candidates = [
    { family: 'AM', familyName: '飞行塔类' },
    { family: 'RC', familyName: '过山车类' },
    { family: 'CR', familyName: '转马类' },
    { family: 'WF', familyName: '观览车类（摩天轮）' },
    { family: 'FR', familyName: '自旋滑车类' }
  ]
  return candidates.map((item) => ({
    label: `${item.family} · ${item.familyName}${existing.has(item.family) ? '' : '（首版）'}`,
    value: item.family,
    familyName: item.familyName
  }))
})

function openPublish(family?: string) {
  const target = familyOptions.value.find((item) => item.value === (family ?? 'AM')) ?? familyOptions.value[0]
  publishForm.value.family = target.value
  publishForm.value.familyName = target.familyName
  const latest = [...store.standards].filter((item) => item.family === target.value).sort((a, b) => b.version - a.version)[0]
  const wear = latest?.items.find((item) => item.id === 'wear')
  publishForm.value.wearThreshold = wear?.threshold !== undefined ? String(wear.threshold) : '5.0'
  publishForm.value.wearLimit = wear?.limit ?? '≤ 5.0 mm'
  publishForm.value.changeNote = ''
  showPublish.value = true
}

function submitPublish() {
  const standard = store.releaseStandard(
    publishForm.value.family,
    publishForm.value.familyName,
    publishForm.value.changeNote || `结构磨损限值调整为 ${publishForm.value.wearLimit}`,
    [{ id: 'wear', threshold: parseFloat(publishForm.value.wearThreshold), limit: publishForm.value.wearLimit }],
    publishForm.value.operator
  )
  showPublish.value = false
  message.success(`${standard.id} 已发布；在途任务继续按开始时版本判定，新任务自动执行本版`)
}

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div>
        <h2>检验标准发布</h2>
        <p>标准按设备型号系列版本化。新版本只约束发布之后开始的任务；已开始任务的限值在任务开始时快照冻结，不会串用新标准。</p>
      </div>
      <div>
        <NButton @click="openPublish('AM')">发布新版本</NButton>
        <NButton tertiary @click="store.resetDemo()" style="margin-left: 8px">恢复演示数据</NButton>
      </div>
    </div>

    <div class="standard-groups">
      <article v-for="group in groups" :key="group.family" class="standard-group">
        <header>
          <div>
            <h3>{{ group.family }} · {{ group.familyName }}</h3>
            <small>在途/历史任务 {{ group.records }} 条 · 共 {{ group.standards.length }} 个发布版本</small>
          </div>
          <NButton size="small" tertiary @click="openPublish(group.family)">发布新版本</NButton>
        </header>
        <div v-for="(standard, index) in group.standards" :key="standard.id" class="standard-version" :class="{ latest: index === 0 }">
          <div class="sv-head">
            <NTag size="small" :type="index === 0 ? 'success' : 'default'" :bordered="false">
              {{ index === 0 ? '当前最新版' : `V${standard.version}` }}
            </NTag>
            <strong>{{ standard.id }}</strong>
            <small>{{ fmt(standard.publishedAt) }} · {{ standard.publishedBy }}</small>
            <NTag v-if="standard.isDefault" size="small" type="info" :bordered="false">旧记录默认版本</NTag>
          </div>
          <p>{{ standard.changeNote }}</p>
          <ul class="sv-items">
            <li v-for="item in standard.items" :key="item.id">
              <span>{{ item.name }}</span>
              <b>{{ item.limit }}</b>
              <small>{{ item.requirement }}</small>
            </li>
          </ul>
          <p v-if="index === 0" class="sv-scope">生效范围：仅 {{ standard.publishedAt.slice(0, 10) }} 之后开始的新任务；此前已开始的任务继续按各自固定版本判定。</p>
        </div>
      </article>
    </div>

    <NModal v-model:show="showPublish" preset="card" title="发布检验标准新版本" style="width: 600px">
      <div class="publish-form">
        <label>设备型号系列
          <NSelect v-model:value="publishForm.family" :options="familyOptions" @update:value="(value: string) => { publishForm.familyName = familyOptions.find((item) => item.value === value)?.familyName ?? '' }" />
        </label>
        <label>调整结构磨损限值
          <div class="publish-row">
            <NInput v-model:value="publishForm.wearThreshold" placeholder="阈值数值，如 4.0" />
            <NInput v-model:value="publishForm.wearLimit" placeholder="限值原文，如 ≤ 4.0 mm" />
          </div>
        </label>
        <label>变更说明
          <NInput v-model:value="publishForm.changeNote" type="textarea" :rows="2" placeholder="例如：磨损限值收紧并增加锁止复测要求" />
        </label>
        <label>发布人 <NInput v-model:value="publishForm.operator" /></label>
        <p class="standard-preview">新版本基于该型号当前最新版克隆生成，发布时间即刻生效；在途任务不受影响。</p>
      </div>
      <template #footer>
        <div class="modal-actions">
          <NButton @click="showPublish = false">取消</NButton>
          <NButton type="primary" @click="submitPublish">确认发布</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
