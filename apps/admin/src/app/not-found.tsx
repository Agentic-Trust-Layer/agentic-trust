export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">404 - Page Not Found</h2>
      <p className="text-gray-600 mb-4">The page you are looking for does not exist.</p>
      <a
        href="/"
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Go back home
      </a>
    </div>
  );
}

