import { lazy, Suspense } from 'react';

import { FullPageLoader } from './components/ui';
import StudentApp from './student/StudentApp';

// Students never download the admin dashboard's code.
const AdminApp = lazy(() => import('./admin/AdminApp'));

function App() {
  const isAdminRoute = window.location.pathname.toLowerCase().startsWith('/admin');
  if (isAdminRoute) {
    return (
      <Suspense fallback={<FullPageLoader label="Loading admin dashboard…" />}>
        <AdminApp />
      </Suspense>
    );
  }

  return <StudentApp />;
}

export default App;
