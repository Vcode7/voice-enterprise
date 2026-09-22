import os
import shutil
import tempfile
from pathlib import Path
import pytest
from PIL import Image
import torch

from app.services.trocr_trainer import TrOCRDatasetManager, TrOCRFineTuner


TEST_TMP_DIR = Path(__file__).resolve().parent / ".test_tmp"


@pytest.fixture
def temp_dataset_dir():
    TEST_TMP_DIR.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="test_dataset_", dir=str(TEST_TMP_DIR)))
    yield temp_dir
    if temp_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def temp_models_dir():
    TEST_TMP_DIR.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="test_models_", dir=str(TEST_TMP_DIR)))
    yield temp_dir
    if temp_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_dataset_manager_crud(temp_dataset_dir):
    mgr = TrOCRDatasetManager(dataset_dir=temp_dataset_dir)
    assert mgr.get_sample_count() == 0

    # Add single sample
    img = Image.new("RGB", (100, 40), color="white")
    s1 = mgr.add_sample(img, "99465634", source_doc="test.pdf")
    assert s1["text"] == "99465634"
    assert mgr.get_sample_count() == 1

    # Verify image exists
    img_path = mgr.get_sample_image_path(s1)
    assert img_path.exists()

    # Add batch samples
    items = [
        (Image.new("RGB", (80, 30), color="white"), "FR BTM"),
        (Image.new("RGB", (90, 35), color="white"), "NEW 150"),
    ]
    added = mgr.add_batch_samples(items, source_doc="batch.pdf")
    assert added == 2
    assert mgr.get_sample_count() == 3

    # Update sample
    mgr.update_sample_text(s1["id"], "99465634_UPDATED")
    samples = mgr.get_samples()
    updated = next(s for s in samples if s["id"] == s1["id"])
    assert updated["text"] == "99465634_UPDATED"

    # Stats
    stats = mgr.get_stats()
    assert stats["total_samples"] == 3
    assert stats["distinct_sources"] == 2

    # Delete sample
    mgr.delete_sample(s1["id"])
    assert mgr.get_sample_count() == 2
    assert not img_path.exists()

    # Clear dataset
    mgr.clear_dataset()
    assert mgr.get_sample_count() == 0


def test_fine_tuner_initialization_and_metadata(temp_dataset_dir, temp_models_dir):
    mgr = TrOCRDatasetManager(dataset_dir=temp_dataset_dir)
    tuner = TrOCRFineTuner(models_dir=temp_models_dir, dataset_manager=mgr)

    # Initial model source info should be base
    info = tuner.get_model_source_info()
    assert info["is_finetuned"] is False
    assert tuner.get_latest_checkpoint_path() is None


@pytest.mark.skip(reason="TrOCR deprecated; single-engine Chandra V2 architecture in place")
def test_fine_tuner_train_step(temp_dataset_dir, temp_models_dir):
    mgr = TrOCRDatasetManager(dataset_dir=temp_dataset_dir)
    # Add 2 synthetic samples
    mgr.add_sample(Image.new("RGB", (120, 40), color="white"), "1363", source_doc="doc1.pdf")
    mgr.add_sample(Image.new("RGB", (120, 40), color="white"), "99465634", source_doc="doc1.pdf")

    tuner = TrOCRFineTuner(models_dir=temp_models_dir, dataset_manager=mgr)

    recorded_progress = []

    def progress_cb(data):
        recorded_progress.append(data)

    summary = tuner.train(
        epochs=1,
        batch_size=2,
        learning_rate=5e-5,
        device_name="cpu",
        freeze_encoder=True,
        progress_callback=progress_cb,
    )

    assert summary["trained_samples_count"] == 2
    assert summary["epochs"] == 1
    assert "checkpoint_name" in summary

    # Checkpoint and latest directory verification
    latest_path = tuner.get_latest_checkpoint_path()
    assert latest_path is not None
    assert (latest_path / "config.json").exists()
    assert (latest_path / "training_info.json").exists()

    # Verify model source info now reflects fine-tuned status
    model_info = tuner.get_model_source_info()
    assert model_info["is_finetuned"] is True
    assert model_info["type"] == "fine-tuned"
