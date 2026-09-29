import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import StandardsView from '../views/StandardsView.vue'
import DefectBoardView from '../views/DefectBoardView.vue'
import InspectionDetailView from '../views/InspectionDetailView.vue'
import AuditView from '../views/AuditView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/standards', name: 'standards', component: StandardsView },
    { path: '/defects', name: 'defects', component: DefectBoardView },
    { path: '/records/:id', name: 'record', component: InspectionDetailView, props: true },
    { path: '/audit', name: 'audit', component: AuditView }
  ]
})
