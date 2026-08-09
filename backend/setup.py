from setuptools import setup, find_packages

setup(
    name="folio-backend",
    version="0.0.1",
    packages=find_packages(exclude=["tests", "tests.*"]),
    package_data={"folio_backend": ["schema.sql"]},
    include_package_data=True,
    install_requires=[
        "fastapi", "uvicorn", "pydantic",
        "ebooklib", "beautifulsoup4", "python-multipart", "httpx",
    ],
    entry_points={"console_scripts": ["folio-backend = folio_backend.main:run"]},
)
