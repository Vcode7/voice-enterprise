import os
import sys
import json
import struct
import gc
import torch
import safetensors.torch

SNAPSHOT_DIR = r"C:\Users\vikas\.cache\huggingface\hub\models--datalab-to--chandra-ocr-2\snapshots\af93b47dba1b47b6640c86ccf487ed2260ab9a09"
MONOLITH_PATH = os.path.join(SNAPSHOT_DIR, "model.safetensors")

def main():
    if not os.path.exists(MONOLITH_PATH):
        print(f"Monolithic model.safetensors not found at: {MONOLITH_PATH}")
        print("Checking if sharded files already exist...")
        index_path = os.path.join(SNAPSHOT_DIR, "model.safetensors.index.json")
        if os.path.exists(index_path):
            print("Sharded checkpoint already exists! Nothing to do.")
            return
        sys.exit(1)

    print(f"Reading header from {MONOLITH_PATH}...")
    with open(MONOLITH_PATH, "rb") as f:
        header_len = struct.unpack("<Q", f.read(8))[0]
        header = json.loads(f.read(header_len).decode("utf-8"))

    tensor_keys = [k for k in header.keys() if k != "__metadata__"]
    total_tensors = len(tensor_keys)
    print(f"Total tensors to shard: {total_tensors}")

    # Calculate shard distribution (target ~2.65 GB per shard)
    MAX_SHARD_SIZE = 2700 * 1024 * 1024  # 2.7 GB

    shards = []
    current_shard = []
    current_size = 0

    for key in tensor_keys:
        info = header[key]
        size = info["data_offsets"][1] - info["data_offsets"][0]
        if current_size + size > MAX_SHARD_SIZE and current_shard:
            shards.append(current_shard)
            current_shard = []
            current_size = 0
        current_shard.append(key)
        current_size += size

    if current_shard:
        shards.append(current_shard)

    num_shards = len(shards)
    print(f"Partitioned {total_tensors} tensors into {num_shards} shards.")

    weight_map = {}
    total_bytes_written = 0

    with open(MONOLITH_PATH, "rb") as f:
        for shard_idx, shard_keys in enumerate(shards, start=1):
            shard_filename = f"model-{shard_idx:05d}-of-{num_shards:05d}.safetensors"
            shard_filepath = os.path.join(SNAPSHOT_DIR, shard_filename)
            print(f"Writing Shard {shard_idx}/{num_shards}: {shard_filename} ({len(shard_keys)} tensors)...")

            shard_tensors = {}
            for k in shard_keys:
                info = header[k]
                start, end = info["data_offsets"]
                f.seek(8 + header_len + start)
                raw = f.read(end - start)
                tensor = torch.frombuffer(bytearray(raw), dtype=torch.bfloat16).reshape(info["shape"]).clone()
                shard_tensors[k] = tensor
                weight_map[k] = shard_filename
                total_bytes_written += (end - start)

            safetensors.torch.save_file(shard_tensors, shard_filepath)
            del shard_tensors
            gc.collect()
            print(f"  -> Saved {shard_filepath} ({os.path.getsize(shard_filepath)/(1024**3):.2f} GB)")

    # Write model.safetensors.index.json
    index_data = {
        "metadata": {
            "total_size": total_bytes_written
        },
        "weight_map": weight_map
    }
    index_path = os.path.join(SNAPSHOT_DIR, "model.safetensors.index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=2)
    print(f"Saved index file to {index_path}")

    # Delete monolithic file to reclaim 10.6 GB disk space
    print(f"Removing original monolithic file to reclaim disk space: {MONOLITH_PATH}...")
    os.remove(MONOLITH_PATH)
    print("Sharding completed successfully!")

if __name__ == "__main__":
    main()
