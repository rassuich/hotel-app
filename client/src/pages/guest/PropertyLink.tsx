import { Navigate, useParams } from 'react-router-dom';
import { setSelectedProperty } from '../../lib/hooks';

/**
 * Hotel-specific public link (e.g. /p/palace-anfa). It only brands the
 * validation screen; it never grants access.
 */
export default function PropertyLink() {
  const { propertyId } = useParams();
  if (propertyId && /^[a-z0-9-]{2,60}$/.test(propertyId)) setSelectedProperty(propertyId);
  return <Navigate to="/" replace />;
}
