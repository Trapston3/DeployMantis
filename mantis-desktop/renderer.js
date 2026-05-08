const startBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  statusDiv.textContent = 'Initializing Docker Compose (this may take a moment)...';

  try {
    const output = await window.deploymantis.startCluster();
    statusDiv.textContent = 'Cluster started successfully. Redirecting...';
    
    // Give services a moment to become healthy
    setTimeout(() => {
      window.deploymantis.loadDashboard();
    }, 2000);
  } catch (error) {
    statusDiv.textContent = 'Error starting cluster. Check console.';
    statusDiv.style.color = '#ef4444'; // Red for error
    startBtn.disabled = false;
    startBtn.textContent = 'Retry Start';
  }
});
