import MapView from '@/components/MapView';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="bg-green-800 text-white p-4 text-center font-bold">
        Farm Land Vegetation
      </header>

        <div >
          <MapView />
        </div>
    </main>
  );
}