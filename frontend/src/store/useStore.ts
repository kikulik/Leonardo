import create from 'zustand';

interface State {
  devices: any[];
  addDevice: (device: any) => void;
}

export const useStore = create<State>((set) => ({
  devices: [],
  addDevice: (device) => set((state) => ({ devices: [...state.devices, device] })),
}));
