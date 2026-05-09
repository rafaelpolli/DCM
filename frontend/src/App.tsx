import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login/LoginPage';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { ContractsListPage } from './pages/Contracts/ContractsListPage';
import { ContractDetailPage } from './pages/Contracts/ContractDetailPage';
import { ContractCreatePage } from './pages/Contracts/ContractCreatePage';
import { RequestsListPage } from './pages/Requests/RequestsListPage';
import { RequestDetailPage } from './pages/Requests/RequestDetailPage';
import { StudioPage } from './pages/Studio/StudioPage';
import { EvalPage } from './pages/Eval/EvalPage';
import { TracesPage } from './pages/Traces/TracesPage';
import { DeploymentsPage } from './pages/Deployments/DeploymentsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthGuard><Layout /></AuthGuard>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/contracts" element={<ContractsListPage />} />
          <Route path="/contracts/new" element={<ContractCreatePage />} />
          <Route path="/contracts/:id" element={<ContractDetailPage />} />
          <Route path="/requests" element={<RequestsListPage />} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/agents" element={<StudioPage />} />
          <Route path="/eval" element={<EvalPage />} />
          <Route path="/traces" element={<TracesPage />} />
          <Route path="/deployments" element={<DeploymentsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
