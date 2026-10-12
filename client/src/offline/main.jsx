import { createRoot } from 'react-dom/client';
import OfflineApp from './OfflineApp.jsx';
import '../styles/global.css';
import '../styles/browser.css';
import './offline.css';

createRoot(document.getElementById('root')).render(<OfflineApp />);
