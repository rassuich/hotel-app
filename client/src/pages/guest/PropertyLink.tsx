import { Navigate, useParams } from 'react-router-dom';
import { setSelectedProperty } from '../../lib/hooks';

/**
 * Public hotel QR / property-specific link (e.g. /p/palace-anfa). It only
 * selects the hotel; it never authenticates anyone.
 */
export default function PropertyLink() {
  const { propertyId } = useParams();
  if (propertyId && /^[a-z0-9-]{2,60}$/.test(propertyId)) setSelectedProperty(propertyId);
  return <Navigate to="/h" replace />;
}
