import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { GuestProvider } from './lib/guest';
import Welcome from './pages/guest/Welcome';
import PropertyLink from './pages/guest/PropertyLink';
import GuestShell from './pages/guest/GuestShell';
import Home from './pages/guest/Home';
import Food from './pages/guest/Food';
import Cart from './pages/guest/Cart';
import Services from './pages/guest/Services';
import Requests from './pages/guest/Requests';
import RequestDetail from './pages/guest/RequestDetail';
import Stay from './pages/guest/Stay';
import Activate from './pages/guest/Activate';
import StaffApp from './pages/staff/StaffApp';
import Queue from './pages/staff/Queue';
import Admin from './pages/admin/Admin';

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/p/:propertyId" element={<PropertyLink />} />
          <Route
            path="/activate"
            element={
              <GuestProvider>
                <Activate />
              </GuestProvider>
            }
          />
          <Route
            path="/h"
            element={
              <GuestProvider>
                <GuestShell />
              </GuestProvider>
            }
          >
            <Route index element={<Home />} />
            <Route path="food" element={<Food />} />
            <Route path="food/cart" element={<Cart />} />
            <Route path="services" element={<Services />} />
            <Route path="requests" element={<Requests />} />
            <Route path="requests/:ref" element={<RequestDetail />} />
            <Route path="stay" element={<Stay />} />
          </Route>
          <Route
            path="/staff/*"
            element={
              <StaffApp>
                <Queue />
              </StaffApp>
            }
          />
          <Route
            path="/admin/*"
            element={
              <StaffApp allowAdmin>
                <Admin />
              </StaffApp>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
