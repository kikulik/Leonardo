import React from 'react';
import { Canvas } from './components/Canvas';
import { DeviceCatalog
       } from './components/DeviceCatalog';
import { Chat } from './components/Chat';

function App() {
  return (
    <div className="flex h-screen">
      <DeviceCatalog />
      <Canvas />
      <Chat />
    </div>
  );
}

export default App;
