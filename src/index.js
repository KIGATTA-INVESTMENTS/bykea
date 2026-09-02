import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/medianGeolocation';
import './lib/firebase';
// Must stay ABOVE the React mount below. A notification tap cold-starts the app
// directly into the push listener, before any component exists to register one.
import './lib/driverPushBootstrap';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
