<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { judgeReading, newEvidenceId } from '../services/domain'
import type { CheckResult, InspectionRecord, InspectionStatus } from '../types'

const route = useRoute()
const router = useRouter()
const store = useInspectionStore()
const message = useMessage()
const dialog = useDialog()

// 每个浏览器窗口一个标识，写入修订链，冲突时可辨认先后保存的窗口
const windowId = `WIN-${Math.random().toString(36).slice(2, 7)}`
const operatorName = ref('周宁')
const evidenceInput = ref('')
// 本窗口打开页面时读到的修订号（乐观锁基线）
const baseRevision = ref(0)
const retestForm = reactive({ passed: false, summary: '', tester: '周宁', nextRetestAt: '2026-09-30T10:00' })

const record = computed(() => store.findRecord(String(route.params.id)))
const fixedStandard = computed(() => (record.value ? store.standardById(record.value.standardId) : undefined))
const revisionList = computed(() => (record.value ? [...record.value.revisions].reverse() : []))
const conflictRevisions = computed(() => revisionList.value.filter((item) => item.kind === '冲突修订'))
const retests = computed(() => (record.value ? [...record.value.retests].reverse() : []))
const stale = computed(() => (record.value ? record.value.revision > baseRevision.value : false))
const familyStandards = computed(() =>
  record.value
    ? [...store.standards].filter((item) => item.family === record.value!.family).sort((a, b) => b.version - a.version)
    : []
)

const form = reactive<{
  assignedTo: string
  disposition: string
  risk: InspectionRecord['risk']
  dueDate: string
  stopped: boolean
  evidenceIds: string[]
  items: InspectionRecord['items']
}>({ assignedTo: '', disposition: '', risk: '中', dueDate: '', stopped: false, evidenceIds: [], items: [] })

function syncForm(value: InspectionRecord | undefined) {
  if (!value) return
  form.assignedTo = value.assignedTo
  form.disposition = value.disposition
  form.risk = value.risk
  form.dueDate = value.dueDate
  form.stopped = value.stopped
  form.evidenceIds = [...value.evidenceIds]
  form.items = structuredClone(value.items)
  baseRevision.value = value.revision
}

// 只在进入/切换记录时同步表单并建立乐观锁基线；
// 其他窗口后续保存不会冲掉本窗口正在编辑的内容，仅通过“已过期”横幅提示冲突。
watch(() => route.params.id, (id) => {
  syncForm(store.findRecord(String(id)))
}, { immediate: true })

const transitions: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '已关闭', '停用']

function predictedResult(row: InspectionRecord['items'][number]): CheckResult {
  const def = fixedStandard.value?.items.find((item) => item.id === row.id)
  if (!def) return row.result
  return judgeReading(row.reading, def)
}

function save() {
  if (!record.value) return
  const outcome = store.saveRecord(record.value.id, {
    baseRevision: baseRevision.value,
    operator: operatorName.value,
    windowId,
    assignedTo: form.assignedTo,
    disposition: form.disposition,
    risk: form.risk,
    dueDate: form.dueDate,
    stopped: form.stopped,
    evidenceIds: form.evidenceIds,
    items: form.items
  })
  if (!outcome.ok) {
    message.error(outcome.message)
    return
  }
  if (outcome.conflict) message.warning(outcome.message)
  else message.success(outcome.message)
  syncForm(record.value)
}

/** 演示早晚班两个窗口先后保存：模拟另一窗口先以最新修订号保存 */
function simulateOtherWindowSave() {
  if (!record.value) return
  const target = record.value
  const evidence = newEvidenceId()
  const outcome = store.saveRecord(target.id, {
    baseRevision: target.revision,
    operator: '晚班窗口·林岚',
    windowId: 'WIN-SIM-LATE',
    assignedTo: '维修一组（晚班）',
    disposition: `${target.disposition || '现场处置'}；晚班窗口补充：已设置隔离围栏，备件已领用`.replace(/^；/, ''),
    risk: target.risk,
    dueDate: target.dueDate,
    stopped: target.stopped,
    evidenceIds: [evidence],
    items: structuredClone(target.items)
  })
  message.info(`另一窗口已先保存（R${target.revision}，证据 ${evidence}），本页面修订基线已落后；你再点“保存”即触发冲突修订`)
  void outcome
}

function adopt(revisionId: string) {
  if (!record.value) return
  dialog.info({
    title: '采纳冲突修订中的后保存意见',
    content: '将以当前最新修订为基线，把后保存窗口填写的责任人与处置结论正式采纳；先保存窗口的证据编号仍保留。',
    positiveText: '确认采纳',
    negativeText: '取消',
    onPositiveClick: () => {
      const outcome = store.adoptProposal(record.value!.id, revisionId, operatorName.value)
      outcome.ok ? message.success(outcome.message) : message.error(outcome.message)
      syncForm(record.value)
    }
  })
}

function refreshBaseline() {
  if (!record.value) return
  syncForm(record.value)
  message.success(`已按最新 R${record.value.revision} 刷新本窗口，未保存的输入已被对端内容覆盖`)
}

function addEvidence() {
  const value = evidenceInput.value.trim()
  if (value) {
    if (!form.evidenceIds.includes(value)) form.evidenceIds.push(value)
    evidenceInput.value = ''
  } else {
    form.evidenceIds.push(newEvidenceId())
  }
}

function assignStandard(standardId: string) {
  if (!record.value || !standardId) return
  store.assignStandardVersion(record.value.id, standardId, operatorName.value)
  syncForm(record.value)
  message.success('已指派适用标准并重新快照检验项')
}

function changeStatus(next: InspectionStatus) {
  if (!record.value) return
  dialog.warning({
    title: `确认流转至${next}`,
    content: '系统会校验异常项、停用状态和复测要求，并写入修订链与审计。',
    positiveText: '确认流转',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.transition(record.value!.id, next, `由${record.value!.status}流转至${next}（${windowId}）`, operatorName.value)
      result.ok ? message.success(result.message) : message.error(result.message)
      syncForm(record.value)
    }
  })
}

function submitRetest() {
  if (!record.value) return
  const result = store.retest(record.value.id, {
    tester: retestForm.tester || operatorName.value,
    passed: retestForm.passed,
    summary: retestForm.summary,
    nextRetestAt: retestForm.passed ? undefined : retestForm.nextRetestAt
  })
  result.ok ? message.success(result.message) : message.error(result.message)
  if (result.ok) {
    retestForm.summary = ''
    syncForm(record.value)
  }
}

function doReopen() {
  if (!record.value) return
  const result = store.reopenDevice(record.value.id, operatorName.value)
  result.ok ? message.success(result.message) : message.error(result.message)
}

const stopState = computed({
  get: () => (form.stopped ? '停用隔离' : '正常开放'),
  set: (value: string) => { form.stopped = value === '停用隔离' }
})

const columns = [
  { title: '检验项', key: 'name', width: 110 },
  {
    title: '结果', key: 'result', width: 105,
    render: (row: any) => h(NSelect, {
      value: row.result,
      size: 'small',
      options: ['正常', '异常', '不适用'].map((value) => ({ label: value, value })),
      onUpdateValue: (value: CheckResult) => { row.result = value }
    })
  },
  { title: '实测值', key: 'reading', width: 150, render: (row: any) => h(NInput, { value: row.reading, size: 'small', onUpdateValue: (value: string) => { row.reading = value } }) },
  {
    title: '固定版本限值', key: 'limit', width: 200,
    render: (row: any) => h('div', { class: 'limit-cell' }, [
      h('span', row.limit),
      h(NTag, { size: 'tiny', type: 'info', bordered: false }, { default: () => row.standardId || '待指派' })
    ])
  },
  {
    title: '按固定版本预判', key: 'predict', width: 100,
    render: (row: any) => {
      const predicted = predictedResult(row)
      return h(NTag, { size: 'small', type: predicted === '异常' ? 'error' : predicted === '不适用' ? 'default' : 'success', bordered: false }, { default: () => predicted })
    }
  },
  { title: '备注', key: 'note', render: (row: any) => h(NInput, { value: row.note, size: 'small', placeholder: '现场情况说明', onUpdateValue: (value: string) => { row.note = value } }) }
]

const fmt = (iso: string) => (iso ? iso.replace('T', ' ').slice(0, 16) : '')

function exportRecord() {
  if (!record.value) return
  const blob = new Blob([JSON.stringify(record.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${record.value.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section v-if="record" class="content detail-layout">
    <div class="detail-main">
      <div class="section-head">
        <div>
          <p>{{ record.deviceCode }}（型号 {{ record.family }}）· {{ record.area }} · {{ record.shift }}</p>
          <h2>{{ record.deviceName }}</h2>
        </div>
        <div class="head-actions">
          <NTag :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : record.status === '待复核' ? 'default' : 'warning'" :bordered="false">
            {{ record.stopped && record.status !== '已关闭' ? '设备已停用' : record.status }}
          </NTag>
          <NButton @click="exportRecord">导出记录</NButton>
          <NButton type="primary" @click="save">保存（基线 R{{ baseRevision }}）</NButton>
        </div>
      </div>

      <div v-if="stale" class="conflict-banner">
        <strong>检测到另一窗口已保存：当前修订 R{{ record.revision }}，本窗口基线 R{{ baseRevision }}。</strong>
        <span>继续保存将生成“冲突修订”：你的输入完整保留，对方的责任人/处置结论/证据编号受保护不被覆盖。</span>
        <div>
          <NButton size="small" @click="save">仍按本窗口输入保存（生成冲突修订）</NButton>
          <NButton size="small" tertiary @click="refreshBaseline">放弃本地输入，刷新为最新版本</NButton>
        </div>
      </div>

      <div class="version-card">
        <div>
          <span class="side-label">判定依据（任务开始时冻结）</span>
          <strong v-if="fixedStandard">{{ fixedStandard.id }} · {{ fixedStandard.familyName }}</strong>
          <strong v-else>暂无适用标准版本</strong>
          <small v-if="fixedStandard">{{ fixedStandard.publishedAt.slice(0, 10) }} 发布 · {{ fixedStandard.publishedBy }} · {{ fixedStandard.changeNote }}</small>
          <small v-else>{{ record.reviewReason }}</small>
        </div>
        <div v-if="record.status === '待复核'" class="assign-standard">
          <NSelect :value="''" placeholder="指派适用标准版本" :options="familyStandards.map((item) => ({ label: `${item.id}（V${item.version}）`, value: item.id }))" style="width: 240px" @update:value="assignStandard" />
          <span v-if="!familyStandards.length" class="validation">该型号还没有任何已发布版本，请到“标准发布”新建。</span>
        </div>
      </div>

      <div class="form-band">
        <label>整改责任人 <NInput v-model:value="form.assignedTo" /></label>
        <label>截止日期 <input v-model="form.dueDate" class="native-date" type="date" /></label>
        <label>风险等级 <NSelect v-model:value="form.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value }))" /></label>
        <label>设备状态 <NSelect v-model:value="stopState" :options="['正常开放', '停用隔离'].map((value) => ({ label: value, value }))" /></label>
      </div>

      <label class="disposition-block">
        <span>缺陷处置结论</span>
        <NInput v-model:value="form.disposition" type="textarea" :rows="2" placeholder="记录隔离措施、维修方案、备件与现场交接情况" />
      </label>

      <h3>逐项检验结果（限值取自固定版本，后续发布新标准不串改本任务）</h3>
      <NDataTable :columns="columns" :data="form.items" :bordered="false" size="small" />

      <div class="evidence-panel">
        <div class="evidence-head">
          <strong>现场证据编号</strong>
          <span>先保存窗口的编号在冲突时受保护，后保存编号合并去重</span>
        </div>
        <div class="evidence-list">
          <NTag v-for="evidenceId in form.evidenceIds" :key="evidenceId" size="small" type="info" :bordered="false">{{ evidenceId }}</NTag>
          <span v-if="!form.evidenceIds.length" class="validation">暂无证据</span>
        </div>
        <div class="evidence-add">
          <NInput v-model:value="evidenceInput" size="small" placeholder="输入证据编号，留空则自动生成" style="max-width: 300px" @keyup.enter="addEvidence" />
          <NButton size="small" @click="addEvidence">登记证据</NButton>
          <NButton size="small" tertiary @click="simulateOtherWindowSave">模拟另一窗口先保存</NButton>
        </div>
      </div>

      <div class="retest-panel">
        <div class="evidence-head">
          <strong>复测与放行</strong>
          <span>复测失败：继续停用并预约下一次复测；复测通过后才能恢复开放</span>
        </div>
        <div v-if="retests.length" class="retest-list">
          <article v-for="retest in retests" :key="retest.id" :class="{ failed: !retest.passed, passed: retest.passed }">
            <header>
              <NTag size="small" :type="retest.passed ? 'success' : 'error'" :bordered="false">第 {{ retest.round }} 次复测 · {{ retest.passed ? '通过' : '未通过' }}</NTag>
              <small>{{ fmt(retest.testedAt) }} · {{ retest.tester }} · 依据 {{ retest.standardId }}</small>
            </header>
            <p>{{ retest.summary }}</p>
            <small v-if="!retest.passed" class="next-retest">下一次复测：{{ fmt(retest.nextRetestAt || '') }} · 设备保持停用</small>
            <small v-else-if="retest.reopened">已据此恢复开放</small>
            <small v-else>通过后待执行“恢复开放”</small>
          </article>
        </div>
        <div v-if="['待复测', '停用'].includes(record.status)" class="retest-form">
          <div class="retest-row">
            <span>复测结论</span>
            <NSwitch v-model:value="retestForm.passed">
              <template #checked>通过</template>
              <template #unchecked>未通过</template>
            </NSwitch>
            <span v-if="!retestForm.passed" class="next-retest">
              下一次复测
              <input v-model="retestForm.nextRetestAt" class="native-date" type="datetime-local" />
            </span>
          </div>
          <NInput v-model:value="retestForm.summary" type="textarea" :rows="2" placeholder="复测情况说明（实测值、整改复核结论）" />
          <div class="retest-row">
            <span>复测人 <NInput v-model:value="retestForm.tester" size="small" style="width: 140px" /></span>
            <NButton size="small" type="primary" @click="submitRetest">登记复测</NButton>
            <NButton v-if="retestForm.passed === false && record.stopped" size="small" disabled>停用中，复测通过前不可开放</NButton>
          </div>
        </div>
        <div class="retest-row" v-else-if="retests[0]?.passed && record.stopped">
          <NButton size="small" type="primary" @click="doReopen">恢复开放（依据第 {{ retests[0]?.round }} 次通过复测）</NButton>
        </div>
      </div>

      <div v-if="conflictRevisions.length" class="conflict-list">
        <h3>冲突修订（后保存窗口输入留存）</h3>
        <article v-for="revision in conflictRevisions" :key="revision.id">
          <header>
            <NTag size="small" type="warning" :bordered="false">{{ revision.id }} · R{{ revision.revision }}</NTag>
            <small>{{ fmt(revision.at) }} · {{ revision.operator }} / {{ revision.windowId }}（基于 R{{ revision.baseRevision }}）</small>
          </header>
          <p>{{ revision.note }}</p>
          <dl v-if="revision.priorProtected">
            <dt>先保存窗口受保护内容（{{ revision.priorProtected.operator }} / {{ revision.priorProtected.windowId }}，R{{ revision.priorProtected.revision }}）</dt>
            <dd>责任人：{{ revision.priorProtected.assignedTo }}</dd>
            <dd>处置结论：{{ revision.priorProtected.disposition || '（空）' }}</dd>
            <dd>证据编号：{{ revision.priorProtected.evidenceIds.join('、') || '（无）' }}</dd>
            <dt>本窗口意见（可采纳）</dt>
            <dd>责任人：{{ revision.fields.assignedTo }}</dd>
            <dd>处置结论：{{ revision.fields.disposition || '（空）' }}</dd>
          </dl>
          <NButton size="small" @click="adopt(revision.id)">采纳本窗口意见</NButton>
        </article>
      </div>
    </div>

    <aside class="detail-side">
      <div>
        <span class="side-label">当前流程</span>
        <strong>{{ record.status }}</strong>
        <small>修订 R{{ record.revision }} · 更新于 {{ fmt(record.updatedAt) }}</small>
        <small>本窗口 {{ windowId }} · 操作人</small>
        <NInput v-model:value="operatorName" size="small" />
      </div>
      <div class="flow-list">
        <button v-for="status in transitions" :key="status" :class="{ active: status === record.status }" @click="changeStatus(status)">
          <span>{{ status }}</span><small>{{ status === record.status ? '当前状态' : '执行流转' }}</small>
        </button>
      </div>
      <div class="rule-note">
        <strong>闭环校验</strong>
        <p>异常项存在时禁止关闭；紧急风险必须先停用。复测失败继续停用并续排复测，通过后才能恢复开放。所有判定均沿修订链与复测记录可追溯。</p>
      </div>
      <NButton block @click="router.push('/audit')">查看完整审计</NButton>
    </aside>

    <div class="revision-trail">
      <h3>判定依据链：标准版本 → 修订（含冲突修订）→ 复测记录</h3>
      <article v-for="revision in revisionList" :key="revision.id" class="revision-item" :class="`kind-${revision.kind}`">
        <div class="revision-meta">
          <NTag size="small" :type="revision.kind === '冲突修订' ? 'warning' : revision.kind.includes('复测') || revision.kind === '停用隔离' ? 'error' : revision.kind === '恢复开放' ? 'success' : 'default'" :bordered="false">
            {{ revision.kind }}
          </NTag>
          <strong>R{{ revision.revision }}</strong>
          <small>{{ fmt(revision.at) }} · {{ revision.operator }} <template v-if="revision.windowId">/ {{ revision.windowId }}</template> · 基线 R{{ revision.baseRevision }}</small>
        </div>
        <p>{{ revision.note }}</p>
        <small v-if="revision.standardId" class="revision-standard">判定标准：{{ revision.standardId }}</small>
      </article>
    </div>
  </section>
  <section v-else class="content empty-state">未找到检验记录</section>
</template>
