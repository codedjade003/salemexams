import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/student.css';
import './styles/questions.css';
import './styles/admin.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
