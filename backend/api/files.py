"""
File management endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile
from fastapi.responses import StreamingResponse

from models import FileUploadResponse, DataFileInfo
from core.auth import get_current_user
from core.utils import (
    get_user_data_folder, detect_file_type, load_data_file, 
    serialize_dataframe_for_json, validate_file_path
)

router = APIRouter(prefix="/files", tags=["file_management"])


@router.get("/")
async def get_user_files(current_user: dict = Depends(get_current_user)):
    """Get user's files"""
    user_id = current_user['id']
    data_folder = get_user_data_folder(user_id)
    
    files = []
    
    # Recursively find all files in the user's data folder
    for file_path in data_folder.rglob('*'):
        if file_path.is_file() and not file_path.name.startswith('.'):
            # Get relative path from the data folder
            relative_path = file_path.relative_to(data_folder)
            files.append({
                "filename": str(relative_path),
                "display_name": file_path.name,
                "size": file_path.stat().st_size,
                "created_at": file_path.stat().st_ctime,
                "file_type": detect_file_type(file_path.name),
                "folder": str(relative_path.parent) if relative_path.parent != '.' else ""
            })
    
    return {"files": files}


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(file: UploadFile, current_user: dict = Depends(get_current_user)):
    """Upload file to user's data folder"""
    user_id = current_user['id']
    data_folder = get_user_data_folder(user_id)
    
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    file_path = data_folder / file.filename
    
    # Check if file already exists
    if file_path.exists():
        raise HTTPException(status_code=409, detail=f"File {file.filename} already exists")
    
    # Save file
    try:
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    
    file_type = detect_file_type(file.filename)
    
    return {
        "filename": file.filename,
        "size": len(content),
        "upload_time": str(file_path.stat().st_ctime),
        "file_type": file_type,
        "preview_available": file_type in ['csv', 'json', 'parquet']
    }


@router.get("/{filename:path}")
async def download_file(filename: str, current_user: dict = Depends(get_current_user)):
    """Download user's file"""
    user_id = current_user['id']
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename
    
    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(status_code=403, detail="Access denied: file outside allowed directory")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")
    
    def iterfile():
        with open(file_path, mode="rb") as file_like:
            yield from file_like
    
    # Get just the filename for the download header
    download_filename = file_path.name
    
    return StreamingResponse(
        iterfile(), 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={download_filename}"}
    )


@router.delete("/{filename:path}")
async def delete_file(filename: str, current_user: dict = Depends(get_current_user)):
    """Delete user's file"""
    user_id = current_user['id']
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename
    
    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(status_code=403, detail="Access denied: file outside allowed directory")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")
    
    try:
        file_path.unlink()
        return {"message": f"File {filename} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")


@router.get("/{filename}/preview")
async def get_file_preview(filename: str, current_user: dict = Depends(get_current_user)):
    """Get file preview (first 10 rows)"""
    user_id = current_user['id']
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename
    
    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(status_code=403, detail="Access denied: file outside allowed directory")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")
    
    try:
        df = load_data_file(file_path)
        
        # Get preview (first 10 rows)
        if hasattr(df, 'head'):
            preview_df = df.head(10)
        else:
            preview_df = df
        
        # Convert to records for JSON
        if hasattr(preview_df, 'to_dict'):
            preview_data = preview_df.fillna('None').to_dict(orient="records")
        else:
            preview_data = []
        
        return {
            "filename": filename,
            "preview": preview_data,
            "total_rows": len(df) if hasattr(df, '__len__') else 0,
            "columns": list(df.columns) if hasattr(df, 'columns') else []
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading file: {str(e)}")


@router.get("/{filename}/info")
async def get_file_info(filename: str, current_user: dict = Depends(get_current_user)):
    """Get detailed file information"""
    user_id = current_user['id']
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename
    
    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(status_code=403, detail="Access denied: file outside allowed directory")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")
    
    try:
        stat = file_path.stat()
        file_type = detect_file_type(filename)
        
        # Try to get DataFrame info
        df_info = None
        try:
            df = load_data_file(file_path)
            df_info = serialize_dataframe_for_json(df)
        except Exception:
            pass
        
        return {
            "filename": filename,
            "size": stat.st_size,
            "size_mb": stat.st_size / (1024 * 1024),
            "created_at": stat.st_ctime,
            "modified_at": stat.st_mtime,
            "file_type": file_type,
            "dataframe_info": df_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting file info: {str(e)}")
