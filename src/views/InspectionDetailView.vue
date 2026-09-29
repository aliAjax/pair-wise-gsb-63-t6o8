<script setup lang="ts">
import { computed, h, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { judgeItem } from '../services/standards'
import { deepClone } from '../utils/clone'
import type { CheckResult, EvidenceRef, InspectionItem, RiskLevel, InspectionStatus } from '../types'

const route = useRoute()
const router = useRouter()
const store = useInspectionStore()
const message = useMessage()
const dialog = useDialog()

const record = computed(() => store.records.find((item) => item.id === route.params.id))

const form = reactive({
  assignedTo: '',
  dueDate: '',
  risk: '中' as RiskLevel,
  stopped: false,
  disposition: '',
  operator: '当前窗口 · 周宁',
  baseRevision: 0,
  items: [] as InspectionItem[],
  pendingEvidence: [] as EvidenceRef[],
  evidenceName: ''
})

function loadForm() {
  if (!record.value) return
  const value = record.value
  Object.assign(form, {
    assignedTo: value.assignedTo,
    dueDate: value.dueDate,
    risk: value.risk,
    stopped: value.stopped,
    disposition: value.disposition,
    baseRevision: value.revision,
    items: deepClone(value.items),
    pendingEvidence: []
  })
  rebuildRetestDraft()
}

watch(() => route.params.id, loadForm, { immediate: true })

const stopState = computed({
  get: () => form.stopped ? '停用隔离' : '正常开放',
  set: (value: string) => { form.stopped = value === '停用隔离' }
})

const conflicts = computed(() => record.value ? store.conflictsOf(record.value.id) : [])

const newestStandard = computed(() =>
  record.value ? store.standardForModel(record.value.deviceModel) : null)

const standardOutdated = computed(() =>
  !!record.value && !!newestStandard.value && newestStandard.value!.version > record.value.standardVersion)

const allEvidence = computed(() => {
  const existing = record.value?.evidence ?? []
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const item of form.pendingEvidence) if (!map.has(item.id)) map.set(item.id, item)
  return [...map.values()]
})

function save() {
  if (!record.value) return
  const result = store.saveRecord({
    id: record.value.id,
    baseRevision: form.baseRevision,
    operator: form.operator || '当前窗口',
    assignedTo: form.assignedTo,
    dueDate: form.dueDate,
    risk: form.risk,
    stopped: form.stopped,
    items: form.items,
    disposition: form.disposition,
    evidence: form.pendingEvidence
  })
  if (result.ok) {
    form.baseRevision = record.value.revision
    form.pendingEvidence = []
    result.conflict ? message.warning(result.message) : message.success(result.message)
  } else {
    message.error(result.message)
  }
}

function simulateOtherWindow() {
  if (!record.value) return
  dialog.info({
    title: '并发窗口演练',
    content: '将模拟晚班窗口在另一标签先保存一次（责任人/处置结论变更、R 版本 +1）。之后在本窗口点击保存，即可看到后保存保留输入、先保存留档为冲突修订。',
    positiveText: '模拟晚班先保存',
    negativeText: '取消',
    onPositiveClick: () => {
      store.simulateConcurrentSave(record.value!.id)
      message.info('另一窗口已先保存，本窗口基准版本已落后，请直接点「保存本窗口记录」')
    }
  })
}

function uploadEvidence() {
  const item: EvidenceRef = {
    id: `EV-${Date.now().toString().slice(-10)}`,
    name: form.evidenceName || `现场照片 ${form.pendingEvidence.length + 1}`,
    uploadedAt: new Date().toISOString(),
    uploadedBy: form.operator
  }
  form.pendingEvidence.push(item)
  form.evidenceName = ''
  message.success(`证据 ${item.id} 已加入本窗口，保存后随记录合并保留`)
}

function changeStatus(next: InspectionStatus) {
  if (!record.value) return
  dialog.warning({
    title: `确认流转至${next}`,
    content: '系统会校验异常项、停用状态和复测要求，并写入操作审计。',
    positiveText: '确认流转',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.transition(record.value!.id, next, `由${record.value!.status}流转至${next}`, form.operator)
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

function adopt(standardId: string) {
  if (!record.value || !standardId) return
  const std = store.standards.find((item) => item.id === standardId)
  if (!std) return
  dialog.warning({
    title: `补绑检验标准 ${std.label}`,
    content: `检验项将按 ${std.label} 重建并需重新录入，停用维持到检验/复测通过。确认补绑？`,
    positiveText: '确认补绑',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.adoptStandard(record.value!.id, standardId, form.operator)
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

// ---------- 复测 ----------
interface RetestRow { itemId: string; itemName: string; reading: string; limit: string; pass: boolean; numeric: boolean; override: boolean }

function makeRetestRow(item: { id: string; name: string; limit: string }): RetestRow {
  return {
    itemId: item.id, itemName: item.name, reading: '', limit: item.limit,
    pass: false, numeric: /≤\s*[\d.]+/.test(item.limit), override: false
  }
}

const retestDraft = reactive<{ rows: RetestRow[]; note: string; nextDate: string; tester: string }>({
  rows: [], note: '', nextDate: '', tester: '复测组 · 冯爽'
})

function rebuildRetestDraft() {
  if (!record.value) return
  retestDraft.rows = record.value.items
    .filter((item) => item.result === '异常')
    .map((item) => makeRetestRow(item))
  retestDraft.note = ''
  retestDraft.nextDate = store.defaultNextRetestDate()
}

watch(() => record.value?.items.map((item) => `${item.id}:${item.result}`).join(','), () => {
  // 外部更新（补绑/流转）后保持行列表与异常项一致，已填读数尽量保留
  if (!record.value) return
  const currentIds = new Set(retestDraft.rows.map((row) => row.itemId))
  for (const item of record.value.items.filter((candidate) => candidate.result === '异常' && !currentIds.has(candidate.id))) {
    retestDraft.rows.push(makeRetestRow(item))
  }
})

function evaluateRows() {
  for (const row of retestDraft.rows) {
    if (row.override) continue
    if (row.numeric) {
      row.pass = judgeItem({ result: '正常', reading: row.reading, limit: row.limit }) === 'pass'
    }
    // 无数值限值的检验项需现场人工判定（通过下方选择），未判定前保持不合格
  }
}

function setVerdict(row: RetestRow, value: 'auto' | 'pass' | 'fail') {
  row.override = value !== 'auto'
  if (value === 'auto') {
    evaluateRows()
  } else {
    row.pass = value === 'pass'
  }
}

function quickFill(shouldPass: boolean) {
  for (const row of retestDraft.rows) {
    const bound = row.limit.match(/≤\s*([\d.]+)/)
    if (bound) {
      const value = shouldPass ? Number(bound[1]) * 0.8 : Number(bound[1]) * 1.15
      const unit = row.limit.replace(/.*≤\s*[\d.]+\s*/, '').trim()
      row.reading = `${value.toFixed(1)} ${unit}`.trim()
      row.override = false
    } else {
      row.reading = shouldPass ? '闭合可靠 / 联锁有效' : '存在间隙 / 动作不到位'
      row.override = true
      row.pass = shouldPass
    }
  }
  evaluateRows()
}

function submitRetest() {
  if (!record.value) return
  evaluateRows()
  if (!retestDraft.rows.length) {
    message.error('没有需要复测的异常项')
    return
  }
  if (retestDraft.rows.some((row) => !row.reading.trim())) {
    message.error('请填写全部复测读数')
    return
  }
  if (retestDraft.rows.some((row) => !row.numeric && !row.override)) {
    message.error('「无可见间隙 / 动作可靠」类检验项请人工选择合格或不合格')
    return
  }
  if (!retestDraft.nextDate) {
    message.error('请填写复测失败时的下一次复测日期')
    return
  }
  const passed = retestDraft.rows.every((row) => row.pass)
  dialog[passed ? 'success' : 'warning']({
    title: passed ? '复测通过' : '复测未通过',
    content: passed
      ? '所有复测项符合开始时冻结版本限值，提交后解除停用、恢复开放并关闭任务。'
      : `存在不符合 ${record.value.standardLabel} 的项目，提交后设备继续停用，并登记 ${retestDraft.nextDate} 为下一次复测。`,
    positiveText: '提交复测结果',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.submitRetest({
        recordId: record.value!.id,
        tester: retestDraft.tester,
        readings: retestDraft.rows.map((row) => ({ ...row })),
        note: retestDraft.note,
        nextRetestDate: retestDraft.nextDate
      })
      result.ok ? message.success(result.message) : message.error(result.message)
      if (result.ok) rebuildRetestDraft()
    }
  })
}

// ---------- 表格列 ----------
const itemColumns = [
  { title: '检验项', key: 'name', width: 130 },
  {
    title: '结果', key: 'result', width: 120,
    render: (row: InspectionItem) => h(NSelect, {
      value: row.result,
      options: ['正常', '异常', '不适用'].map((value) => ({ label: value, value })),
      onUpdateValue: (value: CheckResult) => { row.result = value }
    })
  },
  { title: '实测值', key: 'reading', width: 170, render: (row: InspectionItem) => h(NInput, { value: row.reading, onUpdateValue: (value: string) => { row.reading = value } }) },
  { title: '判定标准（冻结快照）', key: 'limit', width: 190 },
  {
    title: '按冻结版本判定', key: 'judge', width: 130,
    render: (row: InspectionItem) => {
      const verdict = judgeItem(row)
      const type = verdict === 'fail' ? 'error' : verdict === 'pass' ? 'success' : 'default'
      const text = verdict === 'fail' ? '超限/异常' : verdict === 'pass' ? '合格' : '未录入/不适用'
      return h(NTag, { type, size: 'small', bordered: false }, { default: () => text })
    }
  },
  { title: '备注', key: 'note', render: (row: InspectionItem) => h(NInput, { value: row.note, onUpdateValue: (value: string) => { row.note = value } }) }
]

const retestColumns = [
  { title: '轮次', key: 'round', width: 60, render: (row: any) => `#${row.round}` },
  { title: '时间', key: 'testedAt', width: 150, render: (row: any) => row.testedAt.replace('T', ' ').slice(0, 16) },
  { title: '复测人', key: 'tester', width: 130 },
  {
    title: '结果', key: 'result', width: 90,
    render: (row: any) => h(NTag, { type: row.result === '通过' ? 'success' : 'error', size: 'small', bordered: false }, { default: () => row.result })
  },
  {
    title: '复测读数', key: 'readings',
    render: (row: any) => row.readings.map((item: any) =>
      `${item.itemName} ${item.reading}（限值 ${item.limit}，${item.pass ? '合格' : '不合格'}）`).join('；')
  },
  { title: '下一次复测', key: 'next', width: 110, render: (row: any) => row.nextRetestDate ?? '—' }
]

const transitions: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '停用', '已关闭']

const adoptOptions = computed(() =>
  record.value
    ? store.standards
      .filter((item) => item.deviceModel === record.value!.deviceModel)
      .sort((a, b) => b.version - a.version)
      .map((item) => ({ label: `${item.label} · ${item.modelName}（${item.publishedAt.slice(0, 10)} 发布）`, value: item.id }))
    : [])

function exportRecord() {
  if (!record.value) return
  const blob = new Blob([JSON.stringify({
    record: record.value,
    conflictRevisions: conflicts.value,
    retests: record.value.retests
  }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${record.value.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function mergeField(conflictId: string, field: 'assignedTo' | 'disposition' | 'items', label: string) {
  store.mergeConflictField(record.value!.id, conflictId, field, form.operator)
  loadForm()
  message.success(`已将先保存窗口的${label}并回记录`)
}
</script>

<template>
  <section v-if="record" class="content detail-layout">
    <div class="detail-main">
      <div class="section-head">
        <div>
          <p>{{ record.deviceCode }} · {{ record.deviceModel }} 型 · {{ record.area }} · {{ record.shift }}</p>
          <h2>{{ record.deviceName }}</h2>
        </div>
        <div class="head-actions">
          <NTag :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : 'warning'" :bordered="false">
            {{ record.status === '待复核' ? '待复核' : record.stopped ? '设备已停用' : record.status }}
          </NTag>
          <NButton @click="exportRecord">导出依据包</NButton>
          <NButton type="primary" :disabled="record.status === '待复核'" @click="save">保存本窗口记录</NButton>
        </div>
      </div>

      <!-- 版本依据横幅 -->
      <div class="version-banner" :class="{ outdated: standardOutdated, review: record.status === '待复核' }">
        <template v-if="record.status === '待复核'">
          <strong>待复核：{{ record.standardLabel }}</strong>
          <span>{{ record.reviewNote }}</span>
        </template>
        <template v-else>
          <strong>判定依据：检验标准 {{ record.standardLabel }}</strong>
          <span>任务开始于 {{ record.standardFrozenAt.replace('T', ' ').slice(0, 16) }}，标准限值已冻结进本任务</span>
          <em v-if="standardOutdated" class="outdated-tip">
            该型号已有更新的 {{ newestStandard?.label }}（{{ newestStandard?.publishedAt.slice(0, 10) }} 发布），但本任务已开始，仍按 {{ record.standardLabel }} 判定；仅下一次新任务使用新版
          </em>
        </template>
      </div>

      <!-- 待复核：补绑标准 -->
      <div v-if="record.status === '待复核'" class="review-panel evidence-panel">
        <div>
          <strong>人工补绑检验标准</strong>
          <span>为型号 {{ record.deviceModel }} 选择已发布版本，补绑后按该版本重建检验项，停用维持至检验/复测通过</span>
        </div>
        <div class="review-actions">
          <NSelect :options="adoptOptions" placeholder="选择适用标准版本" style="width: 340px" @update:value="adopt" />
          <NButton tag="a" @click="router.push('/standards')">去发布新版本</NButton>
        </div>
      </div>

      <template v-else>
        <div class="form-band">
          <label>本窗口操作人 <NInput v-model:value="form.operator" /></label>
          <label>整改责任人 <NInput v-model:value="form.assignedTo" /></label>
          <label>截止日期 <input v-model="form.dueDate" class="native-date" type="date" /></label>
          <label>风险等级
            <NSelect v-model:value="form.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value }))" />
          </label>
          <label>设备状态 <NSelect v-model:value="stopState" :options="['正常开放', '停用隔离'].map((value) => ({ label: value, value }))" /></label>
        </div>

        <div class="window-strip">
          <span>本窗口基准版本：<b>R{{ form.baseRevision }}</b> / 记录当前：<b>R{{ record.revision }}</b></span>
          <NButton size="tiny" tertiary @click="simulateOtherWindow">演练：模拟另一窗口（晚班）先保存</NButton>
        </div>

        <h3>逐项检验结果（限值取自开始时冻结的 {{ record.standardLabel }}）</h3>
        <NDataTable :columns="itemColumns" :data="form.items" :bordered="false" size="small" />

        <div class="disposition-panel evidence-panel">
          <div class="disposition-input">
            <strong>缺陷处置结论</strong>
            <NInput v-model:value="form.disposition" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="填写现场处置结论，随保存写入；并发时先保存一方的结论会留档为冲突修订" />
          </div>
        </div>

        <div class="evidence-panel evidence-block">
          <div>
            <strong>现场证据（编号不可丢）</strong>
            <span>已保存 {{ record.evidence.length }} 份 · 本窗口待保存 {{ form.pendingEvidence.length }} 份；并发保存时双方证据自动合并</span>
          </div>
          <div class="evidence-upload">
            <NInput v-model:value="form.evidenceName" placeholder="证据名称，如 锁止间隙近景" style="width: 220px" />
            <NButton @click="uploadEvidence">登记证据编号</NButton>
          </div>
        </div>
        <div class="evidence-chips">
          <span v-for="item in allEvidence" :key="item.id" class="evidence-chip">
            <b>{{ item.id }}</b>{{ item.name }}<small>{{ item.uploadedAt.slice(5, 16).replace('T', ' ') }}</small>
          </span>
        </div>

        <!-- 冲突修订 -->
        <div v-if="conflicts.length" class="conflict-revisions">
          <h3>冲突修订（{{ conflicts.length }}）<small>后保存窗口保留自己的输入；先保存一方的责任人、处置结论和证据编号全部留档</small></h3>
          <article v-for="conflict in conflicts" :key="conflict.id" class="conflict-card">
            <header>
              <div>
                <NTag :type="conflict.status === '待解决' ? 'warning' : 'success'" size="small" :bordered="false">{{ conflict.status }}</NTag>
                <b>{{ conflict.id }}</b>
                <small>{{ conflict.detectedAt.replace('T', ' ').slice(0, 16) }}</small>
              </div>
              <small>判定依据 {{ record.standardLabel }}</small>
            </header>
            <p class="conflict-reason">{{ conflict.reason }}</p>
            <div class="conflict-sides">
              <section class="side loser">
                <h4>先保存（被盖写，已留档）· {{ conflict.loserOperator }}</h4>
                <p><span>责任人</span>{{ conflict.loserSnapshot.assignedTo }}</p>
                <p><span>处置结论</span>{{ conflict.loserSnapshot.disposition || '—' }}</p>
                <p class="evidence-ids"><span>证据编号</span>{{ conflict.loserSnapshot.evidenceIds.join('、') || '无' }}</p>
              </section>
              <section class="side winner">
                <h4>后保存（当前保留）· {{ conflict.winnerOperator }}</h4>
                <p><span>责任人</span>{{ conflict.winnerSnapshot.assignedTo }}</p>
                <p><span>处置结论</span>{{ conflict.winnerSnapshot.disposition || '—' }}</p>
                <p class="evidence-ids"><span>证据编号</span>{{ conflict.winnerSnapshot.evidenceIds.join('、') || '无' }}</p>
              </section>
            </div>
            <footer v-if="conflict.status === '待解决'">
              <NButton size="small" @click="mergeField(conflict.id, 'assignedTo', '责任人')">并回先保存责任人</NButton>
              <NButton size="small" @click="mergeField(conflict.id, 'disposition', '处置结论')">并回先保存处置结论</NButton>
              <NButton size="small" @click="mergeField(conflict.id, 'items', '逐项读数')">并回先保存逐项读数</NButton>
            </footer>
          </article>
        </div>

        <!-- 复测 -->
        <div class="retest-panel">
          <h3>复测与放行
            <small v-if="record.nextRetestDate">下一次复测：{{ record.nextRetestDate }}（失败后自动留下，成功后恢复开放）</small>
          </h3>
          <NDataTable v-if="record.retests.length" :columns="retestColumns" :data="record.retests" :bordered="false" size="small" style="margin-bottom: 14px" />

          <div v-if="retestDraft.rows.length" class="retest-form">
            <p class="editor-hint">逐项录入复测读数，按 {{ record.standardLabel }} 限值自动判定；全部合格才能放行，任一不合格则继续停用并登记下一次复测。</p>
            <div class="retest-row" v-for="row in retestDraft.rows" :key="row.itemId">
              <strong>{{ row.itemName }}</strong>
              <NInput v-model:value="row.reading" :placeholder="`限值 ${row.limit}`" style="width: 220px" @blur="evaluateRows" />
              <NTag v-if="row.numeric" :type="row.pass ? 'success' : 'error'" size="small" :bordered="false">{{ row.pass ? '合格' : '不合格' }}</NTag>
              <NSelect
                v-else
                :value="row.override ? (row.pass ? 'pass' : 'fail') : 'auto'"
                size="small"
                style="width: 118px"
                :options="[{ label: '请判定', value: 'auto' }, { label: '合格', value: 'pass' }, { label: '不合格', value: 'fail' }]"
                @update:value="(value: 'auto' | 'pass' | 'fail') => setVerdict(row, value)"
              />
            </div>
            <div class="retest-meta">
              <label>复测人 <NInput v-model:value="retestDraft.tester" style="width: 170px" /></label>
              <label>下一次复测（失败时生效）<input v-model="retestDraft.nextDate" class="native-date" type="date" /></label>
              <NButton size="small" tertiary @click="quickFill(true)">填入合格读数</NButton>
              <NButton size="small" tertiary @click="quickFill(false)">填入不合格读数</NButton>
            </div>
            <label class="retest-note">复测说明 <NInput v-model:value="retestDraft.note" placeholder="如 更换制动片后复测" /></label>
            <NButton type="primary" style="margin-top: 10px" @click="submitRetest">提交复测结果</NButton>
          </div>
          <p v-else class="editor-hint">当前无待复测异常项；复测通过后设备恢复开放并自动关闭任务。</p>
        </div>
      </template>
    </div>

    <aside class="detail-side">
      <div>
        <span class="side-label">当前流程</span>
        <strong>{{ record.status }}</strong>
        <small>标准 {{ record.standardLabel }} · R{{ record.revision }} · 更新于 {{ record.updatedAt.replace('T', ' ').slice(0, 16) }}</small>
        <small v-if="record.lastSavedBy">最近保存窗口：{{ record.lastSavedBy }}</small>
      </div>
      <div v-if="record.status !== '待复核'" class="flow-list">
        <button v-for="status in transitions" :key="status" :class="{ active: status === record.status }" @click="changeStatus(status)">
          <span>{{ status }}</span><small>{{ status === record.status ? '当前状态' : '执行流转' }}</small>
        </button>
      </div>
      <div class="rule-note">
        <strong>闭环校验</strong>
        <p>异常项存在时禁止关闭；复测失败继续停用并自动登记下一次复测，复测全部合格才能恢复开放。所有操作按冻结标准版本写入审计。</p>
      </div>
      <NButton block @click="router.push({ path: '/audit', query: { record: record.id } })">查看本记录判定依据时间线</NButton>
    </aside>
  </section>
  <section v-else class="content empty-state">未找到检验记录</section>
</template>
