#!/bin/bash

# Find all .env_example files in the seed folder and its subfolders
find . -name ".env_example" -not -path "*/node_modules/*" -not -path "*/.angular/*" | while read example_file; do
    # Extract the path and filename of the example file
    path=$(dirname "$example_file")
    filename=$(basename "$example_file")

    # Replace .env_example with .env in the filename
    target_file="$path/.env"

    # Check if the target file already exists
    if [ ! -f "$target_file" ]; then
        # If the target file does not exist, copy the example file to the target file
        cp "$example_file" "$target_file"
        # Print a message to the console
        echo "📝Copied $example_file to $target_file"
    fi
done

