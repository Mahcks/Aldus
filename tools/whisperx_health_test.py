import types
import unittest
from unittest.mock import MagicMock, patch

from whisperx_health import check, deny_network


class HealthTest(unittest.TestCase):
    def modules(self):
        torch = MagicMock()
        torch.cuda.is_available.return_value = True
        torch.cuda.get_device_properties.return_value = types.SimpleNamespace(name="GTX 1050 Ti", total_memory=4*1024**3)
        torch.ones.return_value.__matmul__.return_value.sum.return_value.item.return_value = 4096
        torch.version.cuda = "12.6"
        return {"torch": torch, "ctranslate2": MagicMock(), "nltk": MagicMock(), "whisperx": MagicMock()}

    def test_gpu_execution_is_separate_from_model_readiness(self):
        modules = self.modules()
        modules["ctranslate2"].get_supported_compute_types.return_value = {"int8_float32"}
        with patch.dict("sys.modules", modules), patch.dict("os.environ", {"ALDUS_ALIGNMENT_ACCELERATOR":"cuda"}), patch("shutil.which",return_value="/usr/bin/ffmpeg"):
            result = check("base.en")
            self.assertEqual(result["gpuTest"]["state"], "success")
            self.assertEqual(result["alignment"]["readiness"], "ready")
            self.assertEqual(modules["whisperx"].load_model.call_args.kwargs["compute_type"], "int8_float32")
            self.assertTrue(modules["whisperx"].load_model.call_args.kwargs["local_files_only"])
            modules["whisperx"].load_align_model.side_effect = RuntimeError("missing English model")
            result = check("base.en")
            self.assertEqual(result["gpuTest"]["state"], "success")
            self.assertEqual(result["alignment"]["readiness"], "not_ready")
            self.assertIn("missing English model", result["alignment"]["issues"][0])

    def test_cuda_must_execute_and_cpu_skips_gpu(self):
        modules = self.modules()
        with patch.dict("sys.modules", modules), patch.dict("os.environ", {"ALDUS_ALIGNMENT_ACCELERATOR":"cuda"}):
            modules["torch"].ones.side_effect = RuntimeError("unsupported GPU kernels")
            result = check("base.en")
            self.assertEqual(result["gpuTest"]["state"], "failed")
            self.assertEqual(result["alignment"]["readiness"], "not_ready")
            modules["whisperx"].load_model.assert_not_called()
        with patch.dict("sys.modules", modules), patch.dict("os.environ", {"ALDUS_ALIGNMENT_ACCELERATOR":"cpu"}), patch("shutil.which",return_value=None):
            result = check("base.en")
            self.assertEqual(result["gpuTest"]["state"], "not_applicable")
            self.assertEqual(result["alignment"]["readiness"], "not_ready")
            self.assertIn("FFmpeg",result["alignment"]["issues"][0])

    def test_diagnostics_cannot_download(self):
        with self.assertRaisesRegex(OSError,"never download"):
            deny_network(("huggingface.co",443))

    def test_offline_failure_allows_http_clients_to_use_their_cache(self):
        import socket
        from urllib.error import URLError
        from urllib.request import ProxyHandler, build_opener

        with patch.object(socket.socket, "connect", deny_network):
            with self.assertRaisesRegex(URLError, "never download"):
                build_opener(ProxyHandler({})).open("http://127.0.0.1:9", timeout=1)
