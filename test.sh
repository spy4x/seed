#!/bin/bash

# Set maximum values
max_temp=50
max_ram=$(free | awk '/Mem:/ {print $2}')
max_card=$(df | awk '/\/dev\/root/ {print $2}')
max_disk=$(df | awk '/\/dev\/sda2/ {print $2}')

# Get current values
temp=$(/usr/bin/vcgencmd measure_temp)
temp=${temp:5}  # remove "temp=" from the beginning of the string
temp=${temp%C}  # remove "C" from the end of the string
temp=$(echo $temp | tr -d "'")  # remove single quotes
free_ram=$(free -h --si | awk '/Mem:/ {print $4}')
free_card=$(df -h | awk '/\/dev\/root/ {print $4}')
free_disk=$(df -h | awk '/\/dev\/sda2/ {print $4}')

# Calculate percentage of each value
temp_percent=$(awk "BEGIN { printf \"%.0f\n\", $temp/$max_temp*100 }")
ram_percent=$(awk "BEGIN { printf \"%.0f\n\", $free_ram/$max_ram*100 }")
card_percent=$(awk "BEGIN { printf \"%.0f\n\", $free_card/$max_card*100 }")
disk_percent=$(awk "BEGIN { printf \"%.0f\n\", $free_disk/$max_disk*100 }")

# Format output as a table
output=$(printf "Temp:  %sC  %s%%\nRAM:   %s  %s%%\nCard:  %s  %s%%\nDisk:  %s  %s%%" "$temp" "$temp_percent" "$free_ram" "$ram_percent" "$free_card" "$card_percent" "$free_disk" "$disk_percent")
echo "$output" | column -t
