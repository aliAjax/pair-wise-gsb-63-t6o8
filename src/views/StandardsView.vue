<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { NButton, NDataTable, NInput, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import type { StandardItem } from '../types'

const store = useInspectionStore()
const message = useMessage()
const selectedModel = ref('AM')
const publishedBy = ref('管理员 高安')
const changeNote = ref('')
const draftItems = ref<StandardItem[]>([])
const newModelCode = ref('')
const newModelName = ref('')
const showNewModel = ref(false)

const modelGroups = computed(() => {
  const map = new Map<string, { code: string; name: string; versions: typeof store.standards }>()
  for (const std of store.standards) {
    if (!map.has(std.deviceModel)) map.set(std.deviceModel, { code: std.deviceModel, name: std.modelName, versions: [] })
    map.get(std.deviceModel)!.versions.push(std)
  }
  return [...map.values()].map((group) => ({
    ...group,
    versions: group.versions.sort((a, b) => b.version - a.version)
  })).sort((a, b) => a.code.localeCompare(b.code))
})

const activeGroup = computed(() => modelGroups.value.find((group) => group.code === selectedModel.value) ?? null)
const latest = computed(() => activeGroup.value?.versions[0] ?? null)

function loadDraftFromLatest() {
  if (!latest.value) {
    draftItems.value = []
    return
  }
  draftItems.value = latest.value.items.map((item) => ({ ...item }))
}

function selectModel(code: string) {
  selectedModel.value = code
  changeNote.value = ''
  loadDraftFromLatest()
}

// 初始化首选项草稿
loadDraftFromLatest()

function addItem() {
  draftItems.value.push({ id: `item-${Date.now()}`, name: '', limit: '', method: '' })
}

function removeItem(index: number) {
  draftItems.value.splice(index, 1)
}

const columns = [
  { title: '检验项', key: 'name', width: 150, render: (row: StandardItem) => h(NInput, { value: row.name, placeholder: '如 结构磨损', onUpdateValue: (value: string) => { row.name = value } }) },
  { title: '判定限值', key: 'limit', width: 190, render: (row: StandardItem) => h(NInput, { value: row.limit, placeholder: '如 ≤ 4.0 mm', onUpdateValue: (value: string) => { row.limit = value } }) },
  { title: '检验方法', key: 'method', render: (row: StandardItem) => h(NInput, { value: row.method, type: 'textarea', autosize: { minRows: 1, maxRows: 3 }, onUpdateValue: (value: string) => { row.method = value } }) },
  {
    title: '', key: 'op', width: 64,
    render: (_row: StandardItem, index: number) => h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeItem(index) }, { default: () => '删除' })
  }
]

function publish() {
  const group = activeGroup.value
  if (!group) return
  if (!draftItems.value.length) {
    message.error('至少保留一个检验项')
    return
  }
  if (draftItems.value.some((item) => !item.name || !item.limit)) {
    message.error('检验项名称和判定限值不能为空')
    return
  }
  const nextVersion = store.publishStandard({
    deviceModel: group.code,
    modelName: group.name,
    changeNote: changeNote.value || '例行修订检验标准',
    items: draftItems.value,
    publishedBy: publishedBy.value || '管理员'
  })
  message.success(`${group.code} 型号检验标准 ${nextVersion.label} 已发布：新任务按本版执行，已开始任务仍按开始时版本判定`)
  changeNote.value = ''
  loadDraftFromLatest()
}

function createModel() {
  const code = newModelCode.value.trim().toUpperCase()
  if (!code || !newModelName.value.trim()) {
    message.error('请填写型号代码与名称')
    return
  }
  if (modelGroups.value.some((group) => group.code === code)) {
    message.error('该型号已存在')
    return
  }
  store.publishStandard({
    deviceModel: code,
    modelName: newModelName.value.trim(),
    changeNote: '新型号首次发布检验标准',
    items: draftItems.value.length
      ? draftItems.value
      : [{ id: `item-${Date.now()}`, name: '整机安全检查', limit: '动作可靠', method: '空载试运行一个工作循环' }],
    publishedBy: publishedBy.value || '管理员'
  })
  selectedModel.value = code
  showNewModel.value = false
  newModelCode.value = ''
  newModelName.value = ''
  message.success(`已为新型号 ${code} 发布 V1`)
}
</script>

<template>
  <section class="content standards-layout">
    <div class="board-intro">
      <div>
        <h2>检验标准发布</h2>
        <p>标准按设备型号发布，发布后内容冻结：新任务按最新发布版本执行；已开始的任务仍按开始时那版判定，不串用新标准。</p>
      </div>
      <NButton @click="showNewModel = true">新增设备型号</NButton>
    </div>

    <div class="model-cards">
      <button
        v-for="group in modelGroups"
        :key="group.code"
        class="model-card"
        :class="{ active: group.code === selectedModel }"
        @click="selectModel(group.code)"
      >
        <span class="model-code">{{ group.code }}</span>
        <strong>{{ group.name }}</strong>
        <small>当前 {{ group.versions[0]?.label }} · 共 {{ group.versions.length }} 版</small>
        <small v-if="group.versions[0]" class="model-time">发布于 {{ group.versions[0].publishedAt.replace('T', ' ').slice(0, 16) }}</small>
      </button>
    </div>

    <div v-if="activeGroup" class="standard-grid">
      <div class="standard-editor detail-main">
        <h3>发布新版本 — {{ activeGroup.code }} · {{ activeGroup.name }}</h3>
        <p class="editor-hint">检验项限值将冻结进此后新建的任务；修改后点击发布只影响之后开始的任务。</p>
        <div class="publish-band">
          <label>发布人 <NInput v-model:value="publishedBy" style="width: 170px" /></label>
          <label class="note-label">本次变更说明
            <NInput v-model:value="changeNote" placeholder="如 收紧磨损限值、锁止改双人复核" />
          </label>
        </div>
        <NDataTable :columns="columns" :data="draftItems" :bordered="false" size="small" />
        <div class="editor-actions">
          <NButton tertiary @click="addItem">增加检验项</NButton>
          <NButton type="primary" @click="publish">发布新版本</NButton>
        </div>
      </div>

      <aside class="standard-history detail-side">
        <h3>版本历史（每次判定依据）</h3>
        <div v-for="std in activeGroup.versions" :key="std.id" class="version-item">
          <header>
            <NTag :type="std.version === activeGroup.versions[0].version ? 'success' : 'default'" size="small" :bordered="false">{{ std.label }}</NTag>
            <small>{{ std.publishedAt.replace('T', ' ').slice(0, 16) }}</small>
          </header>
          <p>{{ std.changeNote }}</p>
          <ul>
            <li v-for="item in std.items" :key="item.id">
              <strong>{{ item.name }}</strong><span>{{ item.limit }}</span>
            </li>
          </ul>
          <small class="publisher">发布人：{{ std.publishedBy }}</small>
        </div>
      </aside>
    </div>

    <teleport to="body">
      <div v-if="showNewModel" class="modal-mask" @click.self="showNewModel = false">
        <div class="modal-card">
          <h3>新增设备型号并发布 V1</h3>
          <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0">
            <label>型号代码 <NInput v-model:value="newModelCode" placeholder="如 SP（弹跳类）" /></label>
            <label>型号名称 <NInput v-model:value="newModelName" placeholder="如 弹跳塔类" /></label>
          </div>
          <p class="editor-hint">将使用当前编辑区的检验项作为 V1 内容（可先返回调整检验项，再新增型号）。</p>
          <div class="modal-actions">
            <NButton @click="showNewModel = false">取消</NButton>
            <NButton type="primary" @click="createModel">创建并发布 V1</NButton>
          </div>
        </div>
      </div>
    </teleport>
  </section>
</template>
