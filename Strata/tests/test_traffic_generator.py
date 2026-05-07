import os
import sys
import unittest
import urllib.error
from io import StringIO
from unittest.mock import patch

# Add scripts directory to path to allow importing traffic_generator
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))
import traffic_generator


class TestTrafficGenerator(unittest.TestCase):
    @patch('sys.stderr', new_callable=StringIO)
    @patch('traffic_generator.time.sleep')
    @patch('traffic_generator.urllib.request.urlopen')
    def test_main_url_error_handled(self, mock_urlopen, mock_sleep, mock_stderr):
        """Test that URLError during log posting is caught and logged to stderr."""
        # Arrange
        mock_urlopen.side_effect = urllib.error.URLError('Connection refused')
        mock_sleep.side_effect = KeyboardInterrupt  # Break the infinite loop

        # Act
        with patch('sys.stdout', new_callable=StringIO): # Suppress normal output during test
            traffic_generator.main()

        # Assert
        error_output = mock_stderr.getvalue()
        self.assertIn("Request failed: <urlopen error Connection refused>", error_output)


if __name__ == '__main__':
    unittest.main()
